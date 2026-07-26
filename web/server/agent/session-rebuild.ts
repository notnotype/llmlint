import type {AgentHarnessPort} from "./harness-port";
import type {PrismaClient} from "../database/prisma";

export type AgentRebuildStage = "pending" | "deleted" | "session_created" | "analysis_started" | "completed";

export type AgentRebuildRow = {
    revisionId: string;
    userId: number;
    oldSessionId: string | null;
    newSessionId: string | null;
    invocationId: string | null;
    stage: AgentRebuildStage;
    attempts: number;
    error: string | null;
};

export type AgentRebuildReport = {
    startedAt: string;
    finishedAt: string;
    total: number;
    completed: number;
    failed: number;
    rows: AgentRebuildRow[];
};

export interface AgentSessionRebuilderOptions {
    readonly client: PrismaClient;
    readonly harness: AgentHarnessPort & {reconcileInterrupted(): Promise<void>};
    readonly now?: () => Date;
    readonly wait?: (milliseconds: number) => Promise<void>;
    readonly pollMilliseconds?: number;
    readonly timeoutMilliseconds?: number;
}

/** 显式、幂等、可恢复地重建历史 Agent Session 和 analysis。 */
export class AgentSessionRebuilder {
    private readonly client: PrismaClient;
    private readonly harness: AgentSessionRebuilderOptions["harness"];
    private readonly now: () => Date;
    private readonly wait: (milliseconds: number) => Promise<void>;
    private readonly pollMilliseconds: number;
    private readonly timeoutMilliseconds: number;

    constructor(options: AgentSessionRebuilderOptions) {
        this.client = options.client;
        this.harness = options.harness;
        this.now = options.now ?? (() => new Date());
        this.wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
        this.pollMilliseconds = options.pollMilliseconds ?? 250;
        this.timeoutMilliseconds = options.timeoutMilliseconds ?? 30 * 60 * 1000;
    }

    /** 创建 ledger 并把当前所有 llmlint.review Session 固化为待重建集合。 */
    async prepare(): Promise<void> {
        await this.client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_agent_session_rebuild" (
            "revisionId" TEXT NOT NULL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            "oldSessionId" TEXT,
            "newSessionId" TEXT,
            "invocationId" TEXT,
            "stage" TEXT NOT NULL DEFAULT 'pending',
            "attempts" INTEGER NOT NULL DEFAULT 0,
            "error" TEXT,
            "updatedAt" TEXT NOT NULL
        )`);
        const timestamp = this.now().toISOString();
        await this.client.$executeRawUnsafe(`INSERT OR IGNORE INTO "_agent_session_rebuild" ("revisionId", "userId", "oldSessionId", "stage", "updatedAt")
            SELECT "revisionId", "userId", "id", 'pending', ? FROM "AgentSession" WHERE "profileKey" = 'llmlint.review'`, timestamp);
    }

    /** 从 ledger 当前阶段继续执行；单个 revision 失败不会阻止其他 revision。 */
    async run(): Promise<AgentRebuildReport> {
        const startedAt = this.now().toISOString();
        await this.harness.reconcileInterrupted();
        const rows = await this.rows();
        for (const row of rows) {
            if (row.stage === "completed") continue;
            await this.incrementAttempt(row.revisionId);
            try {
                await this.process(row.revisionId);
                await this.clearError(row.revisionId);
            } catch (error) {
                await this.recordError(row.revisionId, error instanceof Error ? error.message : String(error));
            }
        }
        const completedRows = await this.rows();
        return {
            startedAt,
            finishedAt: this.now().toISOString(),
            total: completedRows.length,
            completed: completedRows.filter(row => row.stage === "completed").length,
            failed: completedRows.filter(row => row.stage !== "completed").length,
            rows: completedRows,
        };
    }

    /** 最终 hard cut 成功后删除临时 ledger。 */
    async cleanup(): Promise<void> {
        await this.client.$executeRawUnsafe(`DROP TABLE IF EXISTS "_agent_session_rebuild"`);
    }

    /** 推进单个 revision，阶段更新只发生在对应动作成功之后。 */
    private async process(revisionId: string): Promise<void> {
        let row = await this.row(revisionId);
        if (row.stage === "pending") {
            const sessions = await this.client.agentSession.findMany({where: {revisionId, profileKey: "llmlint.review"}, select: {id: true}});
            const sessionIds = sessions.map(session => session.id);
            if (sessionIds.length > 0) {
                await this.client.$transaction([
                    this.client.machineLlmReview.deleteMany({where: {sessionId: {in: sessionIds}}}),
                    this.client.agentSessionEntry.deleteMany({where: {sessionId: {in: sessionIds}}}),
                    this.client.agentInvocation.deleteMany({where: {sessionId: {in: sessionIds}}}),
                    this.client.agentSession.deleteMany({where: {id: {in: sessionIds}}}),
                ]);
            }
            await this.update(revisionId, "deleted", {});
            row = await this.row(revisionId);
        }
        if (row.stage === "deleted") {
            const created = await this.harness.createSession(revisionId, row.userId);
            await this.update(revisionId, "session_created", {newSessionId: created.sessionId});
            row = await this.row(revisionId);
        }
        if (row.stage === "session_created") {
            if (!row.newSessionId) throw new Error(`revision ${revisionId} 缺少 newSessionId`);
            const revision = await this.client.revision.findUnique({where: {id: revisionId}, select: {body: true}});
            if (!revision) throw new Error(`revision ${revisionId} 不存在`);
            const accepted = await this.harness.invoke(row.newSessionId, row.userId, {mode: "prompt", phase: "analysis", revisionId});
            await this.update(revisionId, "analysis_started", {invocationId: accepted.invocationId});
            row = await this.row(revisionId);
        }
        if (row.stage === "analysis_started") {
            await this.finishAnalysis(row);
            await this.update(revisionId, "completed", {});
        }
    }

    /** 等待 analysis terminal；中断/失败时通过正式 retry 新建 Invocation。 */
    private async finishAnalysis(row: AgentRebuildRow): Promise<void> {
        if (!row.newSessionId || !row.invocationId) throw new Error(`revision ${row.revisionId} 缺少 analysis 标识`);
        const deadline = Date.now() + this.timeoutMilliseconds;
        let invocationId = row.invocationId;
        while (Date.now() <= deadline) {
            const snapshot = await this.harness.getSnapshot(row.newSessionId, row.userId);
            const invocation = snapshot.invocations.find(item => item.id === invocationId);
            if (!invocation) throw new Error(`Invocation ${invocationId} 不存在`);
            if (invocation.status === "completed") {
                if (!snapshot.report) throw new Error(`Invocation ${invocationId} 已完成但 MachineLlmReview 投影缺失`);
                return;
            }
            if (invocation.status === "failed" || invocation.status === "aborted" || invocation.status === "interrupted") {
                const retried = await this.harness.retry(row.newSessionId, row.userId);
                invocationId = retried.invocationId;
                await this.update(row.revisionId, "analysis_started", {invocationId});
            } else if (invocation.status === "waiting") {
                throw new Error(`Invocation ${invocationId} 意外进入 waiting，迁移命令不能代替用户审批`);
            }
            await this.wait(this.pollMilliseconds);
        }
        throw new Error(`revision ${row.revisionId} analysis 等待超过 ${this.timeoutMilliseconds}ms`);
    }

    /** 返回 ledger 的稳定排序视图。 */
    private async rows(): Promise<AgentRebuildRow[]> {
        const rows = await this.client.$queryRawUnsafe<LedgerDatabaseRow[]>(`SELECT * FROM "_agent_session_rebuild" ORDER BY "revisionId"`);
        return rows.map(mapLedgerRow);
    }

    /** 读取一个 ledger 行。 */
    private async row(revisionId: string): Promise<AgentRebuildRow> {
        const rows = await this.client.$queryRawUnsafe<LedgerDatabaseRow[]>(`SELECT * FROM "_agent_session_rebuild" WHERE "revisionId" = ?`, revisionId);
        const row = rows[0];
        if (!row) throw new Error(`revision ${revisionId} 不在迁移 ledger`);
        return mapLedgerRow(row);
    }

    /** 更新阶段及可选标识。 */
    private async update(revisionId: string, stage: AgentRebuildStage, values: {newSessionId?: string; invocationId?: string}): Promise<void> {
        await this.client.$executeRawUnsafe(
            `UPDATE "_agent_session_rebuild" SET "stage" = ?, "newSessionId" = COALESCE(?, "newSessionId"), "invocationId" = COALESCE(?, "invocationId"), "updatedAt" = ? WHERE "revisionId" = ?`,
            stage,
            values.newSessionId ?? null,
            values.invocationId ?? null,
            this.now().toISOString(),
            revisionId,
        );
    }

    /** 增加本轮尝试计数。 */
    private async incrementAttempt(revisionId: string): Promise<void> {
        await this.client.$executeRawUnsafe(`UPDATE "_agent_session_rebuild" SET "attempts" = "attempts" + 1, "error" = NULL, "updatedAt" = ? WHERE "revisionId" = ?`, this.now().toISOString(), revisionId);
    }

    /** 记录失败原因并保留最后成功阶段。 */
    private async recordError(revisionId: string, message: string): Promise<void> {
        await this.client.$executeRawUnsafe(`UPDATE "_agent_session_rebuild" SET "error" = ?, "updatedAt" = ? WHERE "revisionId" = ?`, message, this.now().toISOString(), revisionId);
    }

    /** 清理已恢复行的旧错误。 */
    private async clearError(revisionId: string): Promise<void> {
        await this.client.$executeRawUnsafe(`UPDATE "_agent_session_rebuild" SET "error" = NULL, "updatedAt" = ? WHERE "revisionId" = ?`, this.now().toISOString(), revisionId);
    }
}

type LedgerDatabaseRow = {
    revisionId: string;
    userId: number | bigint;
    oldSessionId: string | null;
    newSessionId: string | null;
    invocationId: string | null;
    stage: string;
    attempts: number | bigint;
    error: string | null;
};

/** 校验数据库 ledger 行，避免损坏状态被静默解释。 */
function mapLedgerRow(row: LedgerDatabaseRow): AgentRebuildRow {
    if (!isStage(row.stage)) throw new Error(`未知迁移阶段：${row.stage}`);
    return {
        revisionId: row.revisionId,
        userId: Number(row.userId),
        oldSessionId: row.oldSessionId,
        newSessionId: row.newSessionId,
        invocationId: row.invocationId,
        stage: row.stage,
        attempts: Number(row.attempts),
        error: row.error,
    };
}

function isStage(value: string): value is AgentRebuildStage {
    return value === "pending" || value === "deleted" || value === "session_created" || value === "analysis_started" || value === "completed";
}

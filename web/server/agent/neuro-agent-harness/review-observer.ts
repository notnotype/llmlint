import type {JsonValue, SessionCommitNotification, SessionCommitObserver} from "@notnotype/neuro-agent-harness";
import {prisma, type PrismaClient} from "../../database/prisma";
import {parseLlmlintAnalysisResult, type LlmlintAnalysisResult, type LlmlintSessionInitial} from "./profile";

type ReconcileState = {
    dirty: boolean;
    task: Promise<void>;
};

/** 将 durable analysis output 幂等投影到 MachineLlmReview。 */
export class MachineLlmReviewProjector implements SessionCommitObserver<string, LlmlintSessionInitial> {
    readonly name = "llmlint.machineLlmReview";
    private reconcileAllState?: ReconcileState;
    private readonly sessionStates = new Map<string, ReconcileState>();

    constructor(private readonly client: PrismaClient = prisma) {}

    /** commit 后只补该 Session 缺失的 analysis 投影；失败不会改变 Core 已持久化的事实。 */
    async afterCommit(notification: SessionCommitNotification<string, LlmlintSessionInitial>): Promise<void> {
        const completedAnalysis = notification.plan.operations.some((operation) => {
            if (operation.type !== "finishInvocation" || operation.status !== "completed") return false;
            const invocation = notification.result.snapshot.invocations.find((item) => item.id === operation.invocationId);
            const input = invocation?.input;
            return input !== null && typeof input === "object" && !Array.isArray(input) && input.phase === "analysis";
        });
        if (!completedAnalysis) return;
        await this.reconcileSession(notification.result.snapshot.metadata.sessionId);
    }

    /** 修复一个 Session 中 observer 遗漏的 completed analysis 投影。 */
    reconcileSession(sessionId: string): Promise<void> {
        const pending = this.sessionStates.get(sessionId);
        if (pending) {
            pending.dirty = true;
            return pending.task;
        }
        const state: ReconcileState = {dirty: false, task: Promise.resolve()};
        this.sessionStates.set(sessionId, state);
        state.task = this.runSessionReconcile(sessionId, state);
        return state.task;
    }

    /** 合并并发请求，并在运行期间收到新请求时至少追加一轮扫描。 */
    private async runSessionReconcile(sessionId: string, state: ReconcileState): Promise<void> {
        try {
            do {
                state.dirty = false;
                await this.reconcileSessionInternal(sessionId);
            } while (state.dirty);
        } finally {
            if (this.sessionStates.get(sessionId) === state) this.sessionStates.delete(sessionId);
        }
    }

    /** 读取单个 Session 中仍缺失业务投影的 analysis invocation。 */
    private async reconcileSessionInternal(sessionId: string): Promise<void> {
        const session = await this.client.agentSession.findUnique({
            where: {id: sessionId},
            select: {
                invocations: {
                    where: {
                        phase: "analysis",
                        status: "completed",
                        resultJson: {not: null},
                        machineReviews: {none: {}},
                    },
                    select: {id: true, revisionId: true, resultJson: true},
                    orderBy: {createdAt: "asc"},
                },
            },
        });
        if (!session) return;
        for (const invocation of session.invocations) {
            if (!invocation.resultJson) continue;
            await this.project(invocation.revisionId, sessionId, invocation.id, parseLlmlintAnalysisResult(parseJson(invocation.resultJson)));
        }
    }

    /** 启动恢复时扫描全部 completed analysis，保证物化视图最终一致。 */
    reconcileAll(): Promise<void> {
        const pending = this.reconcileAllState;
        if (pending) {
            pending.dirty = true;
            return pending.task;
        }
        const state: ReconcileState = {dirty: false, task: Promise.resolve()};
        this.reconcileAllState = state;
        state.task = this.runAllReconcile(state);
        return state.task;
    }

    /** 全量恢复也使用 dirty rerun，避免 HMR 重入在首轮扫描后丢失新请求。 */
    private async runAllReconcile(state: ReconcileState): Promise<void> {
        try {
            do {
                state.dirty = false;
                await this.reconcileAllMissing();
            } while (state.dirty);
        } finally {
            if (this.reconcileAllState === state) this.reconcileAllState = undefined;
        }
    }

    /** 只读取尚未物化的 completed analysis，避免启动恢复反复写入已有 review。 */
    private async reconcileAllMissing(): Promise<void> {
        const invocations = await this.client.agentInvocation.findMany({
            where: {
                phase: "analysis",
                status: "completed",
                resultJson: {not: null},
                machineReviews: {none: {}},
            },
            select: {
                id: true,
                sessionId: true,
                revisionId: true,
                resultJson: true,
            },
            orderBy: {createdAt: "asc"},
        });
        for (const invocation of invocations) {
            if (!invocation.resultJson) continue;
            await this.project(
                invocation.revisionId,
                invocation.sessionId,
                invocation.id,
                parseLlmlintAnalysisResult(parseJson(invocation.resultJson)),
            );
        }
    }

    /** 写入单个已验证的 analysis 结果。 */
    private async project(revisionId: string, sessionId: string, invocationId: string, output: LlmlintAnalysisResult): Promise<void> {
        const report = output.report;
        await this.client.machineLlmReview.upsert({
            where: {invocationId},
            create: {
                revisionId,
                sessionId,
                invocationId,
                model: output.model,
                promptVersion: output.promptVersion,
                score: output.score,
                confidence: report.confidence,
                hitsJson: JSON.stringify(output.hits),
                reportJson: JSON.stringify(report),
            },
            update: {
                revisionId,
                sessionId,
                model: output.model,
                promptVersion: output.promptVersion,
                score: output.score,
                confidence: report.confidence,
                hitsJson: JSON.stringify(output.hits),
                reportJson: JSON.stringify(report),
            },
        });
    }
}

/** JSON.parse 是外部持久化边界，先收为 unknown 再交给 Profile validator。 */
function parseJson(raw: string): JsonValue {
    const value: unknown = JSON.parse(raw);
    return value as JsonValue;
}

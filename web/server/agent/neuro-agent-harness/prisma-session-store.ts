import {randomUUID} from "node:crypto";
import type {
    AgentCaller,
    ApprovalRequest,
    InvocationError,
    InvocationRecord,
    JsonObject,
    JsonValue,
    SessionCommitResult,
    SessionCreateInput,
    SessionEntry,
    SessionEntryDraft,
    SessionId,
    SessionSnapshot,
    SessionStore,
    SessionWriteOperation,
    SessionWritePlan,
} from "@notnotype/neuro-agent-harness";
import {reduceSessionWritePlan, SessionNotFoundError} from "@notnotype/neuro-agent-harness";
import {Prisma, prisma, type PrismaClient} from "../../database/prisma";

/** llmlint 在 Harness 中持久化的宿主身份；业务投影仍由 llmlint 自己读取 revision。 */
export interface LlmlintHostContext extends JsonObject {
    revisionId: string;
    userId: number;
}

type AgentSessionRow = NonNullable<Awaited<ReturnType<typeof loadSessionWith>>>;
type AgentInvocationRow = AgentSessionRow["invocations"][number];
const writeQueues = new Map<string, Promise<void>>();

/** Prisma-backed SessionStore。所有 Harness commit 都在一个数据库事务内完成。 */
export class PrismaSessionStore implements SessionStore<string, LlmlintHostContext> {
    constructor(private readonly client: PrismaClient = prisma) {}

    async allocateId(): Promise<string> {
        return randomUUID();
    }

    async create(input: SessionCreateInput<string, LlmlintHostContext>): Promise<SessionSnapshot<string, LlmlintHostContext>> {
        const sessionId = input.sessionId ?? await this.allocateId();
        const revisionId = this.stringField(input.hostContext, "revisionId");
        const userId = this.numberField(input.hostContext, "userId");
        const row = await withWriteQueue(`create:${revisionId}:${input.profileKey}`, async () => this.client.agentSession.upsert({
            where: {revisionId_profileKey: {revisionId, profileKey: input.profileKey}},
            update: {},
            create: {
                id: sessionId,
                revisionId,
                userId,
                profileKey: input.profileKey,
                initialJson: JSON.stringify(input.initial),
                hostContextJson: JSON.stringify(input.hostContext),
            },
            select: {id: true},
        }));
        return this.read(row.id);
    }

    async read(sessionId: string): Promise<SessionSnapshot<string, LlmlintHostContext>> {
        const row = await loadSessionWith(this.client, sessionId);
        if (!row) throw new SessionNotFoundError(sessionId);
        return mapSnapshot(row);
    }

    async commit(plan: SessionWritePlan<string, LlmlintHostContext>): Promise<SessionCommitResult<string, LlmlintHostContext>> {
        return withWriteQueue(`session:${plan.target}`, async () => this.client.$transaction(async (tx) => {
            const row = await loadSessionWith(tx, plan.target);
            if (!row) throw new SessionNotFoundError(plan.target);
            const current = mapSnapshot(row);
            const reduced = reduceSessionWritePlan(current, plan, {
                now: () => Date.now(),
                entryId: randomUUID,
            });
            const appended = new Set(reduced.entries.map((entry) => entry.id));

            if (reduced.entries.length > 0) {
                await tx.agentSessionEntry.createMany({
                    data: reduced.entries.map((entry) => ({
                        id: entry.id,
                        sessionId: plan.target,
                        invocationId: entry.invocationId ?? null,
                        parentId: entry.parentId,
                        kind: entry.kind,
                        payloadJson: JSON.stringify(entry.payload),
                        createdAt: new Date(entry.timestamp),
                    })),
                });
            }

            for (const operation of plan.operations) {
                await this.applyOperation(tx, plan.target, operation, reduced.snapshot);
            }

            await tx.agentSession.update({
                where: {id: plan.target},
                data: {
                    version: reduced.snapshot.version,
                    status: reduced.snapshot.status,
                    activeLeafId: reduced.snapshot.activeLeafId,
                    hostContextJson: JSON.stringify(reduced.snapshot.metadata.hostContext),
                },
            });

            return {
                snapshot: reduced.snapshot,
                entries: reduced.entries.filter((entry) => appended.has(entry.id)),
            };
        }));
    }

    async reconcileInterrupted(): Promise<readonly InvocationRecord<string>[]> {
        const interrupted = await this.client.agentInvocation.findMany({where: {status: "running"}});
        if (interrupted.length === 0) return [];
        const now = new Date();
        const invocationIds = interrupted.map((item) => item.id);
        const sessionIds = [...new Set(interrupted.map((item) => item.sessionId))];
        await this.client.$transaction([
            this.client.agentInvocation.updateMany({
                where: {id: {in: invocationIds}, status: "running"},
                data: {
                    status: "interrupted",
                    error: "服务重启，运行已中断",
                    errorJson: JSON.stringify({name: "Interrupted", message: "服务重启，运行已中断"} satisfies InvocationError),
                    finishedAt: now,
                },
            }),
            this.client.agentSession.updateMany({where: {id: {in: sessionIds}, status: {in: ["running", "aborting"]}}, data: {status: "interrupted"}}),
        ]);
        const result: InvocationRecord<string>[] = [];
        for (const row of interrupted) {
            const snapshot = await this.read(row.sessionId);
            const invocation = snapshot.invocations.find((item) => item.id === row.id);
            if (invocation) result.push(invocation);
        }
        return result;
    }

    private async applyOperation(
        tx: Prisma.TransactionClient,
        sessionId: string,
        operation: SessionWriteOperation<string, LlmlintHostContext>,
        snapshot: SessionSnapshot<string, LlmlintHostContext>,
    ): Promise<void> {
        if (operation.type === "startInvocation") {
            const invocation = snapshot.invocations.find((item) => item.id === operation.invocation.id);
            if (!invocation) throw new Error(`Invocation ${operation.invocation.id} 写入后不存在`);
            const input = asObject(invocation.input);
            await tx.agentInvocation.create({
                data: {
                    id: invocation.id,
                    sessionId,
                    profileKey: invocation.profileKey,
                    mode: stringOr(input.mode, "prompt"),
                    phase: stringOr(input.phase, "optimize"),
                    status: invocation.status,
                    inputJson: JSON.stringify(invocation.input),
                    callerJson: JSON.stringify(invocation.caller),
                    retryOf: invocation.retryOf ?? null,
                },
            });
            return;
        }

        if (operation.type === "finishInvocation" || operation.type === "waitInvocation" || operation.type === "resumeInvocation") {
            const id = operation.invocationId;
            const invocation = snapshot.invocations.find((item) => item.id === id);
            if (!invocation) throw new Error(`Invocation ${id} 写入后不存在`);
            await tx.agentInvocation.update({
                where: {id},
                data: {
                    status: invocation.status,
                    turns: invocation.turnCount,
                    resultJson: invocation.output === undefined ? null : JSON.stringify(invocation.output),
                    error: invocation.error?.message ?? null,
                    errorJson: invocation.error ? JSON.stringify(invocation.error) : null,
                    pendingApprovalsJson: invocation.pendingApprovals ? JSON.stringify(invocation.pendingApprovals) : null,
                    terminationReason: invocation.terminationReason ?? null,
                    finishedAt: invocation.finishedAt === undefined ? null : new Date(invocation.finishedAt),
                },
            });
        }
    }

    private stringField(value: JsonObject, key: string): string {
        const field = value[key];
        if (typeof field !== "string" || !field.trim()) throw new Error(`hostContext.${key} 必须是非空字符串`);
        return field;
    }

    private numberField(value: JsonObject, key: string): number {
        const field = value[key];
        if (typeof field !== "number" || !Number.isInteger(field)) throw new Error(`hostContext.${key} 必须是整数`);
        return field;
    }
}

async function loadSessionWith(client: PrismaClient | Prisma.TransactionClient, sessionId: string) {
    return client.agentSession.findUnique({
        where: {id: sessionId},
        include: {
            entries: {orderBy: {createdAt: "asc"}},
            invocations: {orderBy: {createdAt: "asc"}},
        },
    });
}

function mapSnapshot(row: AgentSessionRow): SessionSnapshot<string, LlmlintHostContext> {
    return {
        metadata: {
            sessionId: row.id,
            profileKey: row.profileKey,
            initial: parseJson(row.initialJson),
            hostContext: parseJson(row.hostContextJson) as LlmlintHostContext,
            createdAt: row.createdAt.getTime(),
        },
        version: row.version,
        status: row.status as SessionSnapshot<string, LlmlintHostContext>["status"],
        activeLeafId: row.activeLeafId,
        activeInvocationId: row.invocations.find((item) => ["running", "waiting"].includes(item.status))?.id ?? null,
        entries: row.entries.map(mapEntry),
        invocations: row.invocations.map(mapInvocation),
    };
}

function mapEntry(entry: AgentSessionRow["entries"][number]): SessionEntry {
    return {
        id: entry.id,
        invocationId: entry.invocationId ?? undefined,
        parentId: entry.parentId,
        kind: entry.kind,
        payload: parseJson(entry.payloadJson),
        timestamp: entry.createdAt.getTime(),
    };
}

function mapInvocation(row: AgentInvocationRow): InvocationRecord<string> {
    const caller = parseJson(row.callerJson) as AgentCaller<string>;
    return {
        id: row.id,
        sessionId: row.sessionId,
        profileKey: row.profileKey,
        caller,
        input: parseJson(row.inputJson),
        ...(row.retryOf ? {retryOf: row.retryOf} : {}),
        status: row.status as InvocationRecord<string>["status"],
        turnCount: row.turns,
        ...(row.terminationReason ? {terminationReason: parseTerminationReason(row.terminationReason)} : {}),
        ...(row.resultJson ? {output: parseJson(row.resultJson)} : {}),
        ...(row.errorJson ? {error: parseInvocationError(row.errorJson)} : row.error ? {error: {name: "Error", message: row.error}} : {}),
        ...(row.pendingApprovalsJson ? {pendingApprovals: parseApprovalRequests(row.pendingApprovalsJson)} : {}),
        createdAt: row.createdAt.getTime(),
        ...(row.finishedAt ? {finishedAt: row.finishedAt.getTime()} : {}),
    };
}

function parseJson(raw: string): JsonValue {
    return JSON.parse(raw) as JsonValue;
}

function parseInvocationError(raw: string): InvocationError {
    const value = parseJson(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value) || typeof value.name !== "string" || typeof value.message !== "string") {
        throw new Error("AgentInvocation.errorJson 不是合法 InvocationError");
    }
    return {
        name: value.name,
        message: value.message,
        ...(typeof value.phase === "string" ? {phase: value.phase} : {}),
        ...(typeof value.retryable === "boolean" ? {retryable: value.retryable} : {}),
    };
}

function parseApprovalRequests(raw: string): ApprovalRequest[] {
    const value = parseJson(raw);
    if (!Array.isArray(value)) throw new Error("pendingApprovalsJson 必须是数组");
    return value.map((item) => {
        if (item === null || typeof item !== "object" || Array.isArray(item)
            || typeof item.toolCallId !== "string" || typeof item.toolName !== "string" || typeof item.prompt !== "string") {
            throw new Error("pendingApprovalsJson 包含非法 ApprovalRequest");
        }
        return {toolCallId: item.toolCallId, toolName: item.toolName, prompt: item.prompt, arguments: item.arguments ?? null, ...(item.details !== undefined ? {details: item.details} : {})};
    });
}

function asObject(value: JsonValue): JsonObject {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
}

function stringOr(value: JsonValue | undefined, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function parseTerminationReason(value: string): NonNullable<InvocationRecord<string>["terminationReason"]> {
    if (value === "tool_terminate" || value === "natural_stop" || value === "max_turns") return value;
    throw new Error(`AgentInvocation.terminationReason 无效：${value}`);
}

/** 单 Node 进程内按业务键串行化 SQLite 写事务，并在完成后释放队列。 */
async function withWriteQueue<TResult>(key: string, task: () => Promise<TResult>): Promise<TResult> {
    const previous = writeQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    writeQueues.set(key, tail);
    await previous.catch(() => undefined);
    try {
        return await task();
    } finally {
        release();
        if (writeQueues.get(key) === tail) writeQueues.delete(key);
    }
}

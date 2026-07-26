import type {AssistantMessage} from "@earendil-works/pi-ai";
import {
    InvocationConflictError,
    InvocationNotRetryableError,
    type AgentMessage,
    type EventSubscription,
    type HarnessEvent,
    type InvocationRecord,
    type JsonObject,
    type JsonValue,
    type ModelRuntimeEvent,
    type NeuroAgentHarness,
} from "@notnotype/neuro-agent-harness";
import type {AgentEventSubscription, AgentHarnessPort} from "../harness-port";
import type {
    AgentEdit,
    AgentInvokeRequest,
    AgentInvokeResponse,
    AgentInvocationSnapshot,
    AgentSessionEvent,
    AgentSessionSnapshot,
    AgentTimelineEntry,
    AgentTimelineTool,
} from "#shared/agent-harness";
import {prisma, type PrismaClient} from "../../database/prisma";
import {createError} from "h3";
import type {LlmlintHostContext, PrismaSessionStore} from "./prisma-session-store";
import type {MachineLlmReviewProjector} from "./review-observer";

const PROFILE_KEY = "llmlint.review" as const;

export interface NeuroAgentHarnessAdapterOptions {
    readonly core: NeuroAgentHarness<string, LlmlintHostContext, {modelKey: string; maxTokensCap: number}>;
    readonly store: PrismaSessionStore;
    readonly projector: MachineLlmReviewProjector;
    readonly client?: PrismaClient;
}

/** 把 Core 的 durable snapshot 与事件直接投影成 llmlint AgentHarnessPort。 */
export class NeuroAgentHarnessAdapter implements AgentHarnessPort {
    private readonly core: NeuroAgentHarness<string, LlmlintHostContext, {modelKey: string; maxTokensCap: number}>;
    private readonly store: PrismaSessionStore;
    private readonly projector: MachineLlmReviewProjector;
    private readonly client: PrismaClient;
    private reconciliationTask?: Promise<void>;
    private readonly commandQueues = new Map<string, Promise<void>>();

    constructor(options: NeuroAgentHarnessAdapterOptions) {
        this.core = options.core;
        this.store = options.store;
        this.projector = options.projector;
        this.client = options.client ?? prisma;
    }

    /** 为 revision 原子创建或复用唯一 llmlint Session。 */
    async createSession(revisionId: string, userId: number): Promise<{sessionId: string}> {
        const created = await this.core.createSession({
            profileKey: PROFILE_KEY,
            initial: {revisionId, userId},
            hostContext: {revisionId, userId},
        });
        return {sessionId: created.session.metadata.sessionId};
    }

    /** 返回 durable snapshot，并先修复可能遗漏的 MachineLlmReview 投影。 */
    async getSnapshot(sessionId: string, userId: number): Promise<AgentSessionSnapshot> {
        const owned = await ownedSession(sessionId, userId, this.client);
        await this.projector.reconcileSession(sessionId);
        const snapshot = await this.core.snapshot(sessionId);
        const review = await this.client.machineLlmReview.findFirst({where: {sessionId, revisionId: owned.revisionId}, orderBy: {judgedAt: "desc"}});
        const activeInvocation = snapshot.session.invocations.findLast((item) => item.status === "running" || item.status === "waiting");
        const activeWorkspaceEntry = activeInvocation?.input && requestFrom(activeInvocation.input).phase === "optimize"
            ? snapshot.session.entries.findLast((entry) => entry.invocationId === activeInvocation.id && entry.kind === "llmlint.workspace")
            : undefined;
        const activeWorkspacePayload = activeWorkspaceEntry ? asObject(activeWorkspaceEntry.payload) : {};
        return {
            sessionId,
            revisionId: owned.revisionId,
            profileKey: PROFILE_KEY,
            status: mapSessionStatus(snapshot.session.status),
            activeInvocation: activeInvocation ? mapInvocation(activeInvocation) : null,
            activeWorkspace: activeInvocation && typeof activeWorkspacePayload.body === "string"
                ? {invocationId: activeInvocation.id, body: activeWorkspacePayload.body}
                : null,
            invocations: snapshot.session.invocations.map(mapInvocation),
            entries: snapshot.session.entries.map(mapEntry).filter((entry): entry is AgentTimelineEntry => entry !== null),
            report: review ? JSON.parse(review.reportJson) as AgentSessionSnapshot["report"] : null,
            hits: review ? JSON.parse(review.hitsJson) as AgentSessionSnapshot["hits"] : [],
            eventCursor: snapshot.cursor,
        };
    }

    /** 启动一次 Core Invocation；并发冲突稳定映射为 HTTP 409。 */
    async invoke(sessionId: string, userId: number, request: AgentInvokeRequest): Promise<AgentInvokeResponse> {
        return this.runCommand(sessionId, async () => {
            const owned = await ownedSession(sessionId, userId, this.client);
            await invocationRevision(owned.revisionId, request.revisionId, request.phase, this.client);
            try {
                const handle = await this.core.invoke({sessionId, payload: requestPayload(request), caller: {kind: "user"}});
                return {sessionId, invocationId: handle.invocationId, status: "accepted"};
            } catch (error) {
                throw mapConflict(error);
            }
        });
    }

    /** 推进 Session 当前 Revision，并在同一命令临界区启动新版本 analysis。 */
    async advanceRevision(sessionId: string, userId: number, revisionId: string): Promise<AgentInvokeResponse> {
        return this.runCommand(sessionId, async () => {
            const owned = await ownedSession(sessionId, userId, this.client);
            const existing = await this.client.agentInvocation.findFirst({
                where: {sessionId, revisionId, phase: "analysis"},
                orderBy: {createdAt: "desc"},
                select: {id: true},
            });
            if (existing) return {sessionId, invocationId: existing.id, status: "accepted"};
            const [current, target] = await Promise.all([
                this.client.revision.findUnique({where: {id: owned.revisionId}, select: {id: true, textId: true}}),
                this.client.revision.findUnique({where: {id: revisionId}, select: {id: true, textId: true, parentId: true, revealedAt: true}}),
            ]);
            if (!current || !target || target.textId !== current.textId) {
                throw createError({statusCode: 409, message: "目标 Revision 不属于当前 Session Text"});
            }
            const alreadyAdvanced = current.id === target.id;
            if (!alreadyAdvanced && target.parentId !== current.id) {
                throw createError({statusCode: 409, message: "目标 Revision 不是当前 Session 的直接下一版"});
            }
            if (!target.revealedAt) throw createError({statusCode: 409, message: "目标 Revision 尚未揭示，不能推进 Agent Session"});
            const before = await this.core.snapshot(sessionId);
            if (before.session.activeInvocationId) throw createError({statusCode: 409, message: "Agent 正在运行，不能推进 Revision"});
            const advanced = alreadyAdvanced ? null : await this.core.write({
                target: sessionId,
                expectedVersion: before.session.version,
                cause: "llmlint.session.advanceRevision",
                operations: [{type: "setHostContext", hostContext: {revisionId, userId}}],
            });
            try {
                const handle = await this.core.invoke({sessionId, payload: requestPayload({mode: "prompt", phase: "analysis", revisionId}), caller: {kind: "system", name: "revision.reveal"}});
                return {sessionId, invocationId: handle.invocationId, status: "accepted"};
            } catch (error) {
                if (advanced) {
                    await this.core.write({
                        target: sessionId,
                        expectedVersion: advanced.session.version,
                        cause: "llmlint.session.advanceRevision.rollback",
                        operations: [{type: "setHostContext", hostContext: before.session.metadata.hostContext}],
                    });
                }
                throw mapConflict(error);
            }
        });
    }

    /** 中止当前 active Invocation；没有 active work 时保持幂等 idle。 */
    async abort(sessionId: string, userId: number, invocationId: string): Promise<{status: "idle" | "aborting"}> {
        await ownedSession(sessionId, userId, this.client);
        const snapshot = await this.core.snapshot(sessionId);
        if (!snapshot.session.activeInvocationId) return {status: "idle"};
        if (snapshot.session.activeInvocationId !== invocationId) {
            throw createError({statusCode: 409, message: "目标 Invocation 已不是当前活动调用"});
        }
        await this.core.abort(sessionId);
        return {status: "aborting"};
    }

    /** 只允许 failed/aborted/interrupted Invocation 创建 retry，completed 永不重跑。 */
    async retry(sessionId: string, userId: number): Promise<AgentInvokeResponse> {
        await ownedSession(sessionId, userId, this.client);
        const snapshot = await this.core.snapshot(sessionId);
        const latest = snapshot.session.invocations.at(-1);
        if (!latest || !["failed", "aborted", "interrupted"].includes(latest.status)) {
            throw createError({statusCode: 409, message: "当前没有可重试的 Agent invocation"});
        }
        try {
            const handle = await this.core.retry(sessionId, latest.id, {kind: "user"});
            return {sessionId, invocationId: handle.invocationId, status: "accepted"};
        } catch (error) {
            throw mapConflict(error);
        }
    }

    /** 直接包装 Core replay/live subscription，不创建第二层 EventHub。 */
    subscribeEvents(sessionId: string, cursor: {eventEpoch?: string; after: number}): AgentEventSubscription {
        const subscription = this.core.subscribe(sessionId, cursor);
        const partialMessages = new Map<string, AssistantMessage>();
        const adapter = this;
        return {
            connected: {type: "connected", ...subscription.connected},
            async *[Symbol.asyncIterator](): AsyncIterator<AgentSessionEvent> {
                try {
                    for await (const event of subscription) {
                        const mapped = await adapter.mapEvent(event, partialMessages);
                        if (mapped) yield mapped;
                    }
                } finally {
                    partialMessages.clear();
                }
            },
            async close(): Promise<void> {
                partialMessages.clear();
                await subscription.close();
            },
        };
    }

    /** 启动恢复只处理 Core running facts，并修复业务物化视图。 */
    async reconcileInterrupted(): Promise<void> {
        const pending = this.reconciliationTask;
        if (pending) return pending;
        const task = (async () => {
            await this.store.reconcileInterrupted();
            await this.projector.reconcileAll();
        })();
        this.reconciliationTask = task;
        try {
            await task;
        } finally {
            if (this.reconciliationTask === task) this.reconciliationTask = undefined;
        }
    }

    /** 将一个 Core 事件映射成 llmlint SSE envelope。 */
    private async mapEvent(event: HarnessEvent<string>, partialMessages: Map<string, AssistantMessage>): Promise<AgentSessionEvent | null> {
        const invocation = event.invocationId ? {invocationId: event.invocationId} : {};
        if (event.kind === "session") {
            if (event.event.type === "session_entry") {
                if (event.event.entry.kind === "llmlint.workspace") {
                    const payload = asObject(event.event.entry.payload);
                    return event.invocationId && typeof payload.body === "string"
                        ? {...eventBase(event), invocationId: event.invocationId, kind: "session", event: {type: "workspace", invocationId: event.invocationId, body: payload.body}}
                        : null;
                }
                const entry = mapEntry(event.event.entry);
                return entry ? {...eventBase(event), ...invocation, kind: "session", event: {type: "entry", entry}} : null;
            }
            if (event.event.type === "session_status") {
                return {...eventBase(event), ...invocation, kind: "session", event: {type: "status", status: mapSessionStatus(event.event.status), ...invocation}};
            }
            return null;
        }
        if (event.kind === "host") return null;
        const runtime = event.event;
        if (runtime.type === "agent_start") {
            return {...eventBase(event), ...invocation, kind: "runtime", event: {type: "agent_start", phase: await this.invocationPhase(event.sessionId, event.invocationId)}};
        }
        if (runtime.type === "turn_start") return {...eventBase(event), ...invocation, kind: "runtime", event: {type: "turn_start", turn: runtime.turn}};
        if (runtime.type === "turn_end") return {...eventBase(event), ...invocation, kind: "runtime", event: {type: "turn_end", turn: runtime.turn}};
        if (runtime.type === "tool_execution_start") return {...eventBase(event), ...invocation, kind: "runtime", event: {type: "tool_execution_start", turn: runtime.turn, toolCallId: runtime.toolCallId, toolName: runtime.toolName, args: asObject(runtime.arguments)}};
        if (runtime.type === "tool_execution_end") return {...eventBase(event), ...invocation, kind: "runtime", event: {type: "tool_execution_end", turn: runtime.turn, toolCallId: runtime.toolCallId, toolName: runtime.toolName, result: runtime.result, isError: runtime.isError}};
        if (runtime.type === "model_event") return mapModelEvent(event, runtime.turn, runtime.event, partialMessages);
        if (runtime.type === "agent_end") return {...eventBase(event), ...invocation, kind: "runtime", event: {type: "agent_end", status: mapInvocationStatus(runtime.status)}};
        return null;
    }

    /** 从 durable Invocation input 恢复 SSE agent_start 的业务 phase。 */
    private async invocationPhase(sessionId: string, invocationId: string | undefined): Promise<AgentInvokeRequest["phase"]> {
        if (!invocationId) return "optimize";
        const snapshot = await this.store.read(sessionId);
        const invocation = snapshot.invocations.find((item) => item.id === invocationId);
        return requestFrom(invocation?.input).phase;
    }

    /** 串行化同一 Session 的 invoke/advance 命令，关闭检查后竞态窗口。 */
    private async runCommand<TResult>(sessionId: string, task: () => Promise<TResult>): Promise<TResult> {
        const previous = this.commandQueues.get(sessionId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => { release = resolve; });
        const tail = previous.catch(() => undefined).then(() => current);
        this.commandQueues.set(sessionId, tail);
        await previous.catch(() => undefined);
        try {
            return await task();
        } finally {
            release();
            if (this.commandQueues.get(sessionId) === tail) this.commandQueues.delete(sessionId);
        }
    }
}

/** 校验 Session 所有权；权限始终留在宿主 Adapter。 */
async function ownedSession(sessionId: string, userId: number, client: PrismaClient) {
    const session = await client.agentSession.findFirst({where: {id: sessionId, userId}, select: {revisionId: true}});
    if (!session) throw createError({statusCode: 404, message: "Agent session 不存在"});
    return session;
}

/** 校验 Invocation 目标属于 Session 当前 Text；optimize 只能操作当前 Revision。 */
async function invocationRevision(currentRevisionId: string, targetRevisionId: string, phase: AgentInvokeRequest["phase"], client: PrismaClient): Promise<void> {
    const [current, target] = await Promise.all([
        client.revision.findUnique({where: {id: currentRevisionId}, select: {textId: true}}),
        client.revision.findUnique({where: {id: targetRevisionId}, select: {textId: true}}),
    ]);
    if (!current || !target || current.textId !== target.textId) throw createError({statusCode: 404, message: "Invocation Revision 不属于当前 Session Text"});
    if (phase === "optimize" && currentRevisionId !== targetRevisionId) throw createError({statusCode: 409, message: "Optimize 只能修改 Session 当前 Revision"});
}

function mapSessionStatus(status: string): AgentSessionSnapshot["status"] {
    if (status === "running" || status === "aborting" || status === "interrupted" || status === "waiting") return status;
    return "idle";
}

function mapInvocationStatus(status: string): AgentInvocationSnapshot["status"] {
    if (status === "running" || status === "waiting" || status === "completed" || status === "failed" || status === "aborted" || status === "interrupted") return status;
    throw new Error(`未知 Invocation status：${status}`);
}

function mapInvocation(invocation: InvocationRecord<string>): AgentInvocationSnapshot {
    const input = requestFrom(invocation.input);
    return {
        id: invocation.id,
        mode: input.mode,
        phase: input.phase,
        status: mapInvocationStatus(invocation.status),
        turns: invocation.turnCount,
        error: invocation.error?.message ?? null,
        createdAt: new Date(invocation.createdAt).toISOString(),
        finishedAt: invocation.finishedAt === undefined ? null : new Date(invocation.finishedAt).toISOString(),
        input,
        result: input.phase === "optimize" && invocation.output ? invocation.output as AgentInvocationSnapshot["result"] : null,
        ...(invocation.terminationReason ? {terminationReason: invocation.terminationReason} : {}),
    };
}

/** 把 durable entry 投影成刷新后可完整恢复的 timeline。 */
function mapEntry(entry: {id: string; invocationId?: string | null; kind: string; payload: JsonValue; timestamp?: number}): AgentTimelineEntry | null {
    const invocationId = entry.invocationId ?? null;
    const createdAt = new Date(entry.timestamp ?? Date.now()).toISOString();
    if (entry.kind === "llmlint.request") {
        const payload = asObject(entry.payload);
        return typeof payload.text === "string" ? {id: entry.id, invocationId, kind: "user", payload: {text: payload.text, source: "host_request"}, createdAt} : null;
    }
    if (entry.kind === "llmlint.system") {
        const payload = asObject(entry.payload);
        return typeof payload.text === "string" ? {id: entry.id, invocationId, kind: "system", payload: {text: payload.text, source: "system"}, createdAt} : null;
    }
    if (entry.kind === "llmlint.edit") {
        const edit = parseEdit(entry.payload);
        return {id: entry.id, invocationId, kind: "edit", payload: edit, createdAt};
    }
    if (entry.kind === "llmlint.report") {
        const payload = asObject(entry.payload);
        const report = asObject(payload.report) as AgentSessionSnapshot["report"];
        return report ? {id: entry.id, invocationId, kind: "report", payload: {report}, createdAt} : null;
    }
    if (entry.kind !== "agent.message") return null;
    const payload = asObject(entry.payload);
    const message = asObject(payload.message);
    if (message.role === "user") {
        return {id: entry.id, invocationId, kind: "user", payload: {text: typeof message.content === "string" ? message.content : "", source: "model_input"}, createdAt};
    }
    if (message.role === "assistant") {
        const projected = projectAssistant(message.content);
        return {id: entry.id, invocationId, kind: "assistant", payload: {...projected, ...(typeof payload.turn === "number" ? {turns: payload.turn} : {})}, createdAt};
    }
    if (message.role === "toolResult") {
        return {
            id: entry.id,
            invocationId,
            kind: "tool_result",
            payload: {
                ...(typeof message.toolName === "string" ? {toolName: message.toolName} : {}),
                ...(typeof message.toolCallId === "string" ? {toolCallId: message.toolCallId} : {}),
                text: typeof message.content === "string" ? message.content : "",
                isError: message.isError === true,
            },
            createdAt,
        };
    }
    return null;
}

function projectAssistant(value: JsonValue | undefined): {text: string; thinking?: string; tools?: AgentTimelineTool[]} {
    if (!Array.isArray(value)) return {text: ""};
    const text: string[] = [];
    const thinking: string[] = [];
    const tools: AgentTimelineTool[] = [];
    for (const item of value) {
        const block = asObject(item);
        if (block.type === "text" && typeof block.text === "string") text.push(block.text);
        else if (block.type === "thinking" && typeof block.thinking === "string") thinking.push(block.thinking);
        else if (block.type === "toolCall") {
            const call = asObject(block.call);
            if (typeof call.id === "string" && typeof call.name === "string") tools.push({id: call.id, name: call.name, args: asObject(call.arguments), status: "running"});
        }
    }
    return {text: text.join(""), ...(thinking.length ? {thinking: thinking.join("")} : {}), ...(tools.length ? {tools} : {})};
}

function mapModelEvent(
    envelope: HarnessEvent<string>,
    turn: number,
    event: ModelRuntimeEvent,
    partialMessages: Map<string, AssistantMessage>,
): AgentSessionEvent | null {
    const invocationId = envelope.invocationId;
    if (!invocationId) return null;
    const key = `${invocationId}:${turn}`;
    const previous = partialMessages.get(key) ?? assistantMessage([]);
    if (event.type === "message_start") {
        const message = assistantMessage([]);
        partialMessages.set(key, message);
        return {...eventBase(envelope), invocationId, kind: "runtime", event: {type: "message_start", turn, message}};
    }
    if (event.type === "text_delta") {
        const message = appendAssistantText(previous, event.delta);
        partialMessages.set(key, message);
        return {...eventBase(envelope), invocationId, kind: "runtime", event: {type: "message_update", turn, message}};
    }
    if (event.type === "thinking_delta") {
        const message = appendAssistantThinking(previous, event.delta);
        partialMessages.set(key, message);
        return {...eventBase(envelope), invocationId, kind: "runtime", event: {type: "message_update", turn, message}};
    }
    if (event.type === "message_end") {
        partialMessages.delete(key);
        return {...eventBase(envelope), invocationId, kind: "runtime", event: {type: "message_end", turn, message: toPiAssistant(event.message)}};
    }
    return null;
}

function eventBase(event: HarnessEvent<string>): Pick<AgentSessionEvent, "seq" | "eventEpoch" | "sessionId"> {
    return {seq: event.seq, eventEpoch: event.eventEpoch, sessionId: event.sessionId};
}

function assistantMessage(content: readonly AssistantMessage["content"][number][]): AssistantMessage {
    return {role: "assistant", content: [...content], api: "openai-completions", provider: "llmlint", model: "neuro-agent-harness", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}, stopReason: "stop", timestamp: Date.now()};
}

function appendAssistantText(message: AssistantMessage, delta: string): AssistantMessage {
    const content = [...message.content];
    const last = content.at(-1);
    if (last?.type === "text") content[content.length - 1] = {...last, text: last.text + delta};
    else content.push({type: "text", text: delta});
    return {...message, content};
}

function appendAssistantThinking(message: AssistantMessage, delta: string): AssistantMessage {
    const content = [...message.content];
    const last = content.at(-1);
    if (last?.type === "thinking") content[content.length - 1] = {...last, thinking: last.thinking + delta};
    else content.push({type: "thinking", thinking: delta});
    return {...message, content};
}

function toPiAssistant(message: Extract<AgentMessage, {role: "assistant"}>): AssistantMessage {
    const content: AssistantMessage["content"] = [];
    for (const block of message.content) {
        if (block.type === "text") content.push({type: "text", text: block.text});
        else if (block.type === "thinking") content.push({type: "thinking", thinking: block.thinking});
        else content.push({type: "toolCall", id: block.call.id, name: block.call.name, arguments: asObject(block.call.arguments)});
    }
    return assistantMessage(content);
}

function parseEdit(value: JsonValue): AgentEdit {
    const edit = asObject(value);
    return {
        oldText: typeof edit.oldText === "string" ? edit.oldText : "",
        newText: typeof edit.newText === "string" ? edit.newText : "",
        reason: typeof edit.reason === "string" ? edit.reason : null,
    };
}

function requestFrom(value: JsonValue | undefined): AgentInvokeRequest {
    const object = asObject(value);
    if ((object.mode !== "prompt" && object.mode !== "continue") || (object.phase !== "analysis" && object.phase !== "optimize") || typeof object.revisionId !== "string") {
        throw new Error("Agent Invocation input 无效");
    }
    if (object.phase === "analysis") return {mode: object.mode, phase: object.phase, revisionId: object.revisionId};
    if (typeof object.body !== "string") throw new Error("Optimize Invocation input 缺少 body");
    const selection = asObject(object.selection);
    return {
        mode: object.mode,
        phase: object.phase,
        revisionId: object.revisionId,
        body: object.body,
        ...(object.objective === "polish_ai_risk" ? {objective: object.objective} : {}),
        ...(typeof object.message === "string" ? {message: object.message} : {}),
        ...(typeof selection.from === "number" && typeof selection.to === "number" && typeof selection.text === "string"
            ? {selection: {from: selection.from, to: selection.to, text: selection.text}}
            : {}),
    };
}

function asObject(value: JsonValue | undefined): JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requestPayload(request: AgentInvokeRequest): JsonObject {
    if (request.phase === "analysis") return {mode: request.mode, phase: request.phase, revisionId: request.revisionId};
    return {
        mode: request.mode,
        phase: request.phase,
        revisionId: request.revisionId,
        body: request.body,
        ...(request.objective ? {objective: request.objective} : {}),
        ...(request.message !== undefined ? {message: request.message} : {}),
        ...(request.selection ? {selection: {from: request.selection.from, to: request.selection.to, text: request.selection.text}} : {}),
    };
}

function mapConflict(error: unknown): Error {
    if (error instanceof InvocationConflictError || error instanceof InvocationNotRetryableError) {
        return createError({statusCode: 409, message: error.message});
    }
    return error instanceof Error ? error : new Error(String(error));
}

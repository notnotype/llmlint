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
    readonly core: NeuroAgentHarness<string, LlmlintHostContext, {modelKey: string; maxTokensPerTurn: number}>;
    readonly store: PrismaSessionStore;
    readonly projector: MachineLlmReviewProjector;
    readonly client?: PrismaClient;
}

/** 把 Core 的 durable snapshot 与事件直接投影成 llmlint AgentHarnessPort。 */
export class NeuroAgentHarnessAdapter implements AgentHarnessPort {
    private readonly core: NeuroAgentHarness<string, LlmlintHostContext, {modelKey: string; maxTokensPerTurn: number}>;
    private readonly store: PrismaSessionStore;
    private readonly projector: MachineLlmReviewProjector;
    private readonly client: PrismaClient;

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
        const review = await this.client.machineLlmReview.findFirst({where: {sessionId}, orderBy: {judgedAt: "desc"}});
        const activeInvocation = snapshot.session.invocations.findLast((item) => item.status === "running" || item.status === "waiting");
        return {
            sessionId,
            revisionId: owned.revisionId,
            profileKey: PROFILE_KEY,
            status: mapSessionStatus(snapshot.session.status),
            activeInvocation: activeInvocation ? mapInvocation(activeInvocation) : null,
            invocations: snapshot.session.invocations.map(mapInvocation),
            entries: snapshot.session.entries.map(mapEntry).filter((entry): entry is AgentTimelineEntry => entry !== null),
            report: review ? JSON.parse(review.reportJson) as AgentSessionSnapshot["report"] : null,
            hits: review ? JSON.parse(review.hitsJson) as AgentSessionSnapshot["hits"] : [],
            eventCursor: snapshot.cursor,
        };
    }

    /** 启动一次 Core Invocation；并发冲突稳定映射为 HTTP 409。 */
    async invoke(sessionId: string, userId: number, request: AgentInvokeRequest): Promise<AgentInvokeResponse> {
        await ownedSession(sessionId, userId, this.client);
        try {
            const handle = await this.core.invoke({sessionId, payload: requestPayload(request), caller: {kind: "user"}});
            return {sessionId, invocationId: handle.invocationId, status: "accepted"};
        } catch (error) {
            throw mapConflict(error);
        }
    }

    /** 中止当前 active Invocation；没有 active work 时保持幂等 idle。 */
    async abort(sessionId: string, userId: number): Promise<{status: "idle" | "aborted"}> {
        await ownedSession(sessionId, userId, this.client);
        const snapshot = await this.core.snapshot(sessionId);
        if (!snapshot.session.activeInvocationId) return {status: "idle"};
        await this.core.abort(sessionId);
        return {status: "aborted"};
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
        await this.store.reconcileInterrupted();
        await this.projector.reconcileAll();
    }

    /** 将一个 Core 事件映射成 llmlint SSE envelope。 */
    private async mapEvent(event: HarnessEvent<string>, partialMessages: Map<string, AssistantMessage>): Promise<AgentSessionEvent | null> {
        const invocation = event.invocationId ? {invocationId: event.invocationId} : {};
        if (event.kind === "session") {
            if (event.event.type === "session_entry") {
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
}

/** 校验 Session 所有权；权限始终留在宿主 Adapter。 */
async function ownedSession(sessionId: string, userId: number, client: PrismaClient) {
    const session = await client.agentSession.findFirst({where: {id: sessionId, userId}, select: {revisionId: true}});
    if (!session) throw createError({statusCode: 404, message: "Agent session 不存在"});
    return session;
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
        return typeof payload.text === "string" ? {id: entry.id, invocationId, kind: "user", payload: {text: payload.text}, createdAt} : null;
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
    if (message.role === "user") return null;
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
    if ((object.mode !== "prompt" && object.mode !== "continue") || (object.phase !== "analysis" && object.phase !== "optimize") || typeof object.body !== "string") {
        throw new Error("Agent Invocation input 无效");
    }
    const selection = asObject(object.selection);
    return {
        mode: object.mode,
        phase: object.phase,
        body: object.body,
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
    return {
        mode: request.mode,
        phase: request.phase,
        body: request.body,
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

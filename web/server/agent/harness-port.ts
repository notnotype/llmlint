import type {AgentInvokeRequest, AgentInvokeResponse, AgentSessionConnected, AgentSessionEvent, AgentSessionSnapshot} from "#shared/agent-harness";

/** 与 Core 同构的 SSE 订阅；close 后必须释放所有订阅局部状态。 */
export interface AgentEventSubscription extends AsyncIterable<AgentSessionEvent> {
    readonly connected: AgentSessionConnected;
    close(): Promise<void>;
}

/**
 * llmlint 消费的最小 Harness interface。未来 NeuroAgentHarness 独立库只需提供另一个 Adapter。
 */
export interface AgentHarnessPort {
    createSession(revisionId: string, userId: number): Promise<{sessionId: string}>;
    getSnapshot(sessionId: string, userId: number): Promise<AgentSessionSnapshot>;
    invoke(sessionId: string, userId: number, request: AgentInvokeRequest): Promise<AgentInvokeResponse>;
    abort(sessionId: string, userId: number): Promise<{status: "idle" | "aborted"}>;
    retry(sessionId: string, userId: number): Promise<AgentInvokeResponse>;
    subscribeEvents(sessionId: string, cursor: {eventEpoch?: string; after: number}): AgentEventSubscription;
}

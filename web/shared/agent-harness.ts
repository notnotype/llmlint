import type {AssistantMessage} from "@earendil-works/pi-ai";
import type {JsonObject} from "@notnotype/neuro-agent-harness";

export type AgentSessionStatus = "idle" | "running" | "waiting" | "aborting" | "interrupted";
export type AgentInvocationStatus = "running" | "waiting" | "completed" | "failed" | "aborted" | "interrupted";
export type AgentInvocationPhase = "analysis" | "optimize";

export type LlmRuleHit = {
    ruleId: string;
    quote: string;
    reason: string;
    span: {start: number; end: number} | null;
};

export type LlmAnalysisReport = {
    score: number;
    confidence: number;
    conclusion: string;
    evidence: Array<{quote: string; reason: string; ruleIds: string[]}>;
    suggestions: string[];
};

export type AgentEdit = {oldText: string; newText: string; reason: string | null};

export type AgentTimelineTool = {
    id: string;
    name: string;
    args: JsonObject;
    status: "running" | "success" | "error";
    result?: string;
};

export type AgentTimelineEntry = {
    id: string;
    invocationId: string | null;
    kind: "user" | "assistant" | "tool_result" | "edit" | "report" | "lifecycle" | "error";
    payload: {
        text?: string;
        thinking?: string;
        tools?: AgentTimelineTool[];
        toolName?: string;
        toolCallId?: string;
        toolArgs?: JsonObject;
        isError?: boolean;
        oldText?: string;
        newText?: string;
        reason?: string | null;
        report?: LlmAnalysisReport;
        status?: AgentInvocationStatus;
        phase?: AgentInvocationPhase;
        turns?: number;
        message?: string;
    };
    createdAt: string;
};

export type AgentInvocationSnapshot = {
    id: string;
    mode: "prompt" | "continue";
    phase: AgentInvocationPhase;
    status: AgentInvocationStatus;
    turns: number;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
    /** invocation 发起时的真实草稿快照；用于刷新恢复后的 stale 校验与失败重试解释。 */
    input: AgentInvokeRequest;
    result: {body: string; edits: AgentEdit[]; partial: boolean; summary?: string} | null;
    /** completed 时记录 Core 的稳定终止原因。 */
    terminationReason?: "tool_terminate" | "natural_stop" | "max_turns";
};

export type AgentSessionSnapshot = {
    sessionId: string;
    revisionId: string;
    profileKey: "llmlint.review";
    status: AgentSessionStatus;
    activeInvocation: AgentInvocationSnapshot | null;
    invocations: AgentInvocationSnapshot[];
    entries: AgentTimelineEntry[];
    report: LlmAnalysisReport | null;
    hits: LlmRuleHit[];
    eventCursor: {eventEpoch: string; after: number};
};

export type AgentInvokeRequest = {
    mode: "prompt" | "continue";
    phase: AgentInvocationPhase;
    message?: string;
    body: string;
    selection?: {from: number; to: number; text: string};
};

export type AgentInvokeResponse = {sessionId: string; invocationId: string; status: "accepted"};

export type AgentRuntimeEvent =
    | {type: "agent_start"; phase: AgentInvocationPhase}
    | {type: "turn_start"; turn: number}
    | {type: "message_start"; turn: number; message: AssistantMessage}
    | {type: "message_update"; turn: number; message: AssistantMessage}
    | {type: "message_end"; turn: number; message: AssistantMessage}
    | {type: "tool_execution_start"; turn: number; toolCallId: string; toolName: string; args: JsonObject}
    | {type: "tool_execution_end"; turn: number; toolCallId: string; toolName: string; result: string; isError: boolean}
    | {type: "turn_end"; turn: number}
    | {type: "agent_end"; status: AgentInvocationStatus};

export type AgentSessionControlEvent =
    | {type: "entry"; entry: AgentTimelineEntry}
    | {type: "status"; status: AgentSessionStatus; invocationId?: string};

export type AgentSessionEvent = {
    seq: number;
    eventEpoch: string;
    sessionId: string;
    invocationId?: string;
} & (
    | {kind: "runtime"; event: AgentRuntimeEvent}
    | {kind: "session"; event: AgentSessionControlEvent}
);

export type AgentSessionConnected = {
    type: "connected";
    sessionId: string;
    eventEpoch: string;
    latestSeq: number;
    snapshotRequired: boolean;
};

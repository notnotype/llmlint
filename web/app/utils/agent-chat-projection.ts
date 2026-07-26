import type {AssistantMessage} from "@earendil-works/pi-ai";
import type {AgentSessionEvent, AgentSessionSnapshot, AgentTimelineEntry, LlmAnalysisReport} from "#shared/agent-harness";

export type AgentChatTool = {id: string; name: string; args: string; status: "streaming" | "running" | "success" | "error"; result?: string};
export type AgentChatMessage = {
    id: string;
    type: "system" | "user" | "assistant" | "edit" | "report";
    content: string;
    thinking?: string;
    status: "streaming" | "done" | "stopped";
    invocationId?: string;
    tools?: AgentChatTool[];
    edit?: {oldText: string; newText: string; reason: string | null};
    report?: LlmAnalysisReport;
    /** 区分真实用户输入与 Profile 构造的模型输入，避免两者都伪装成“你”。 */
    source?: "system" | "host_request" | "model_input";
};

/** snapshot 的 append-only entries 投影为稳定聊天历史。 */
export function messagesFromSnapshot(snapshot: AgentSessionSnapshot): AgentChatMessage[] {
    let messages: AgentChatMessage[] = [];
    for (const entry of snapshot.entries) messages = applyTimelineEntry(messages, entry);
    return messages;
}

/** NeuroBook 核心 reducer 的 llmlint 子集：正常运行只消费 SSE，不重复 GET snapshot。 */
export function applyAgentEvent(previous: AgentChatMessage[], envelope: AgentSessionEvent): AgentChatMessage[] {
    if (envelope.kind === "session") {
        if (envelope.event.type !== "entry") return previous;
        return applyTimelineEntry(previous, envelope.event.entry);
    }
    const event = envelope.event;
    const messageId = `${envelope.invocationId ?? "run"}:turn:${"turn" in event ? event.turn : 0}`;
    if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
        const projected = assistantMessage(messageId, event.message, event.type === "message_end" ? "done" : "streaming", envelope.invocationId);
        const existing = previous.find((message) => message.id === messageId);
        if (existing && event.type === "message_start") return previous.map((message) => message.id === messageId ? projected : message);
        return existing
            ? previous.map((message) => message.id === messageId ? {...message, ...projected, tools: mergeTools(projected.tools, message.tools)} : message)
            : [...previous, projected];
    }
    if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        const tool: AgentChatTool = event.type === "tool_execution_start"
            ? {id: event.toolCallId, name: event.toolName, args: JSON.stringify(event.args, null, 2), status: "running"}
            : {id: event.toolCallId, name: event.toolName, args: "", status: event.isError ? "error" : "success", result: event.result};
        const owner = previous.findLast((message) => message.type === "assistant" && (message.tools?.some((item) => item.id === tool.id) || message.invocationId === envelope.invocationId));
        if (!owner) {
            return [...previous, {id: messageId, type: "assistant", content: "", status: "streaming", invocationId: envelope.invocationId, tools: [tool]}];
        }
        return previous.map((message) => message.id === owner.id ? {...message, tools: mergeTools([tool], message.tools)} : message);
    }
    if (event.type === "agent_end") {
        return previous.map((message) => message.invocationId === envelope.invocationId && message.status === "streaming" ? {...message, status: event.status === "completed" ? "done" : "stopped"} : message);
    }
    return previous;
}

function entryMessage(entry: AgentTimelineEntry): AgentChatMessage[] {
    if (entry.kind === "system") return [{id: entry.id, type: "system", content: entry.payload.text ?? "", status: "done", invocationId: entry.invocationId ?? undefined, source: "system"}];
    if (entry.kind === "user") return [{
        id: entry.id,
        type: "user",
        content: entry.payload.text ?? "",
        status: "done",
        invocationId: entry.invocationId ?? undefined,
        source: entry.payload.source === "model_input" ? "model_input" : "host_request",
    }];
    if (entry.kind === "assistant") return [{
        id: entry.id,
        type: "assistant",
        content: entry.payload.text ?? "",
        thinking: entry.payload.thinking,
        status: "done",
        invocationId: entry.invocationId ?? undefined,
        tools: entry.payload.tools?.map((tool) => ({id: tool.id, name: tool.name, args: JSON.stringify(tool.args, null, 2), status: tool.status, result: tool.result})),
    }];
    if (entry.kind === "tool_result" && entry.payload.toolCallId && entry.payload.toolName) return [{
        id: entry.id,
        type: "assistant",
        content: "",
        status: "done",
        invocationId: entry.invocationId ?? undefined,
        tools: [{
            id: entry.payload.toolCallId,
            name: entry.payload.toolName,
            args: entry.payload.toolArgs ? JSON.stringify(entry.payload.toolArgs, null, 2) : "",
            status: entry.payload.isError ? "error" : "success",
            result: entry.payload.text,
        }],
    }];
    if (entry.kind === "edit") return [{id: entry.id, type: "edit", content: "", status: "done", invocationId: entry.invocationId ?? undefined, edit: {oldText: entry.payload.oldText ?? "", newText: entry.payload.newText ?? "", reason: entry.payload.reason ?? null}}];
    if (entry.kind === "report" && entry.payload.report) return [{id: entry.id, type: "report", content: entry.payload.report.conclusion, status: "done", invocationId: entry.invocationId ?? undefined, report: entry.payload.report}];
    if (entry.kind === "error") return [];
    return [];
}

/** 将 durable entry 合并到现有 live 投影；Tool Result 必须更新原 Tool Call 而非新增重复卡片。 */
function applyTimelineEntry(previous: AgentChatMessage[], entry: AgentTimelineEntry): AgentChatMessage[] {
    if (entry.kind === "tool_result" && entry.payload.toolCallId && entry.payload.toolName) {
        const tool: AgentChatTool = {
            id: entry.payload.toolCallId,
            name: entry.payload.toolName,
            args: entry.payload.toolArgs ? JSON.stringify(entry.payload.toolArgs, null, 2) : "",
            status: entry.payload.isError ? "error" : "success",
            result: entry.payload.text,
        };
        const owner = previous.findLast(message => message.type === "assistant" && (message.tools?.some(item => item.id === tool.id) || message.invocationId === entry.invocationId));
        if (owner) return previous.map(message => message.id === owner.id ? {...message, tools: mergeTools([tool], message.tools)} : message);
    }
    if (entry.kind === "assistant" && entry.invocationId && entry.payload.turns) {
        const liveId = `${entry.invocationId}:turn:${entry.payload.turns}`;
        const projected = entryMessage(entry)[0];
        if (projected && previous.some(message => message.id === liveId)) {
            return previous.map(message => message.id === liveId ? {...message, ...projected, id: liveId, tools: mergeTools(projected.tools, message.tools)} : message);
        }
    }
    const additions = entryMessage(entry).filter(item => !previous.some(message => message.id === item.id));
    return additions.length > 0 ? [...previous, ...additions] : previous;
}

function assistantMessage(id: string, message: AssistantMessage, status: AgentChatMessage["status"], invocationId?: string): AgentChatMessage {
    const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    const thinking = message.content.filter((block) => block.type === "thinking").map((block) => block.thinking).join("");
    const tools = message.content.filter((block) => block.type === "toolCall").map((block): AgentChatTool => ({id: block.id, name: block.name, args: JSON.stringify(block.arguments, null, 2), status: "streaming"}));
    return {id, type: "assistant", content: text, thinking: thinking || undefined, status, invocationId, tools};
}

function mergeTools(incoming: AgentChatTool[] | undefined, existing: AgentChatTool[] | undefined): AgentChatTool[] | undefined {
    if (!incoming?.length) return existing;
    const map = new Map((existing ?? []).map((tool) => [tool.id, tool]));
    for (const tool of incoming) map.set(tool.id, {...map.get(tool.id), ...tool, args: tool.args || map.get(tool.id)?.args || ""});
    return [...map.values()];
}

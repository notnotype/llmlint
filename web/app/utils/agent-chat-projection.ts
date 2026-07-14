import type {AssistantMessage} from "@earendil-works/pi-ai";
import type {AgentSessionEvent, AgentSessionSnapshot, AgentTimelineEntry} from "#shared/agent-harness";

export type AgentChatTool = {id: string; name: string; args: string; status: "streaming" | "running" | "success" | "error"; result?: string};
export type AgentChatMessage = {
    id: string;
    type: "user" | "assistant" | "system" | "edit" | "report";
    content: string;
    thinking?: string;
    status: "streaming" | "done" | "stopped";
    invocationId?: string;
    tools?: AgentChatTool[];
    edit?: {oldText: string; newText: string; reason: string | null};
};

/** snapshot 的 append-only entries 投影为稳定聊天历史。 */
export function messagesFromSnapshot(snapshot: AgentSessionSnapshot): AgentChatMessage[] {
    return snapshot.entries.flatMap(entryMessage);
}

/** NeuroBook 核心 reducer 的 llmlint 子集：正常运行只消费 SSE，不重复 GET snapshot。 */
export function applyAgentEvent(previous: AgentChatMessage[], envelope: AgentSessionEvent): AgentChatMessage[] {
    if (envelope.kind === "session") {
        if (envelope.event.type !== "entry") return previous;
        const entry = envelope.event.entry;
        if (entry.kind === "assistant" && entry.invocationId && entry.payload.turns) {
            const liveId = `${entry.invocationId}:turn:${entry.payload.turns}`;
            if (previous.some((message) => message.id === liveId)) {
                return previous.map((message) => message.id === liveId ? {...message, content: entry.payload.text ?? message.content, status: "done"} : message);
            }
        }
        const additions = entryMessage(entry).filter((item) => !previous.some((message) => message.id === item.id));
        return additions.length > 0 ? [...previous, ...additions] : previous;
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
    if (entry.kind === "user") return [{id: entry.id, type: "user", content: entry.payload.text ?? "", status: "done", invocationId: entry.invocationId ?? undefined}];
    if (entry.kind === "assistant") return [{id: entry.id, type: "assistant", content: entry.payload.text ?? "", status: "done", invocationId: entry.invocationId ?? undefined}];
    if (entry.kind === "edit") return [{id: entry.id, type: "edit", content: "", status: "done", invocationId: entry.invocationId ?? undefined, edit: {oldText: entry.payload.oldText ?? "", newText: entry.payload.newText ?? "", reason: entry.payload.reason ?? null}}];
    if (entry.kind === "report" && entry.payload.report) return [{id: entry.id, type: "report", content: entry.payload.report.conclusion, status: "done", invocationId: entry.invocationId ?? undefined}];
    if (entry.kind === "error") return [{id: entry.id, type: "system", content: entry.payload.message ?? "Agent 运行失败", status: "done", invocationId: entry.invocationId ?? undefined}];
    return [];
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

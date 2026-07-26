import type {AgentInvocationSnapshot} from "#shared/agent-harness";
import type {AgentChatMessage, AgentChatTool} from "./agent-chat-projection";

export type AgentFlowNode =
    | {kind: "invocation"; id: string; invocation: AgentInvocationSnapshot}
    | {kind: "message"; id: string; message: AgentChatMessage}
    | {kind: "tool"; id: string; invocationId?: string; tool: AgentChatTool}
    | {kind: "edits"; id: string; invocationId?: string; edits: NonNullable<AgentChatMessage["edit"]>[]}
    | {kind: "report"; id: string; message: AgentChatMessage};

export type AgentToolPresentation = {
    kind: "read" | "edit" | "lint_check" | "lint_fix" | "get_revision_detections" | "finish" | "record_rule_hit" | "report_result" | "custom";
    fallbackLabel: string;
    summary: string;
};

export type AgentInvocationPresentation = {
    status: "running" | "waiting" | "completed" | "partial" | "failed" | "aborted" | "interrupted";
    tone: "info" | "success" | "warning" | "danger";
};

const KNOWN_TOOLS = new Set<AgentToolPresentation["kind"]>(["read", "edit", "lint_check", "lint_fix", "get_revision_detections", "finish", "record_rule_hit", "report_result"]);

/** 按 durable Invocation 顺序构造扁平聊天节点，避免模板自行推断运行边界。 */
export function buildAgentFlowNodes(messages: readonly AgentChatMessage[], invocations: readonly AgentInvocationSnapshot[]): AgentFlowNode[] {
    const nodes: AgentFlowNode[] = [];
    const invocationIds = new Set(invocations.map(invocation => invocation.id));
    for (const invocation of invocations) {
        nodes.push({kind: "invocation", id: `invocation:${invocation.id}`, invocation});
        appendMessages(nodes, messages.filter(message => message.invocationId === invocation.id));
    }
    appendMessages(nodes, messages.filter(message => !message.invocationId || !invocationIds.has(message.invocationId)));
    return nodes;
}

/** 将 Invocation 终态映射为稳定 UI 语义，文案由组件按 locale 决定。 */
export function invocationPresentation(invocation: AgentInvocationSnapshot): AgentInvocationPresentation {
    if (invocation.status === "running") return {status: "running", tone: "info"};
    if (invocation.status === "waiting") return {status: "waiting", tone: "info"};
    if (invocation.status === "failed") return {status: "failed", tone: "danger"};
    if (invocation.status === "aborted") return {status: "aborted", tone: "warning"};
    if (invocation.status === "interrupted") return {status: "interrupted", tone: "warning"};
    return invocation.result?.partial ? {status: "partial", tone: "warning"} : {status: "completed", tone: "success"};
}

/** retry 只能针对最新 Invocation；更早失败已被后续运行取代。 */
export function latestRetryableInvocation(invocations: readonly AgentInvocationSnapshot[]): AgentInvocationSnapshot | null {
    const latest = invocations.at(-1);
    return latest && (latest.status === "failed" || latest.status === "aborted" || latest.status === "interrupted") ? latest : null;
}

/** 将 provider 技术错误收敛为用户可行动的解释；未知错误保持原文供诊断。 */
export function invocationErrorMessage(error: string): string {
    if (/终态失败（length|stopReason=length|length（token 预算内没完成本轮/i.test(error)) {
        return "模型本轮输出达到上限，尚未完成工具调用。可以重试本轮。";
    }
    return error;
}

/** 返回工具的人类可读标题与不泄漏大段 JSON 的摘要。 */
export function toolPresentation(tool: AgentChatTool): AgentToolPresentation {
    const args = parseToolArgs(tool.args);
    if (tool.name === "read") {
        const offset = numberArg(args, "offset");
        return {kind: "read", fallbackLabel: tool.name, summary: offset === null ? "current" : `lines ${offset}+`};
    }
    if (tool.name === "record_rule_hit") {
        return {kind: "record_rule_hit", fallbackLabel: tool.name, summary: preview(stringArg(args, "ruleId") || stringArg(args, "quote"))};
    }
    if (tool.name === "finish") {
        return {kind: "finish", fallbackLabel: tool.name, summary: preview(stringArg(args, "summary"))};
    }
    const kind = KNOWN_TOOLS.has(tool.name as AgentToolPresentation["kind"])
        ? tool.name as AgentToolPresentation["kind"]
        : "custom";
    return {kind, fallbackLabel: tool.name, summary: ""};
}

/** 把同一 Invocation 的连续编辑合并，同时将工具从 assistant 正文中拆出。 */
function appendMessages(nodes: AgentFlowNode[], messages: readonly AgentChatMessage[]): void {
    for (const message of messages) {
        if (message.type === "edit" && message.edit) {
            const previous = nodes.at(-1);
            if (previous?.kind === "edits" && previous.invocationId === message.invocationId) {
                nodes[nodes.length - 1] = {...previous, edits: [...previous.edits, message.edit]};
            } else {
                nodes.push({kind: "edits", id: `edits:${message.id}`, ...(message.invocationId ? {invocationId: message.invocationId} : {}), edits: [message.edit]});
            }
            continue;
        }
        if (message.type === "report") {
            nodes.push({kind: "report", id: `report:${message.id}`, message});
            continue;
        }
        const tools = message.tools ?? [];
        if (message.type !== "assistant" || message.content.trim() || message.thinking?.trim() || tools.length === 0) {
            nodes.push({kind: "message", id: `message:${message.id}`, message: {...message, tools: undefined}});
        }
        for (const tool of tools) {
            nodes.push({kind: "tool", id: `tool:${message.id}:${tool.id}`, ...(message.invocationId ? {invocationId: message.invocationId} : {}), tool});
        }
    }
}

type ParsedToolArgs = Readonly<Record<string, string | number | boolean | null>>;

/** Tool args 来自 provider JSON，解析失败只影响摘要，完整原文仍由工具节点展示。 */
function parseToolArgs(value: string): ParsedToolArgs {
    try {
        // JSON.parse 的返回值属于外部未知数据，因此先以 unknown 接收再逐字段收窄。
        const parsed: unknown = JSON.parse(value);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const result: Record<string, string | number | boolean | null> = {};
        for (const [key, item] of Object.entries(parsed)) {
            if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") result[key] = item;
        }
        return result;
    } catch {
        return {};
    }
}

function stringArg(args: ParsedToolArgs, key: string): string {
    const value = args[key];
    return typeof value === "string" ? value : "";
}

function numberArg(args: ParsedToolArgs, key: string): number | null {
    const value = args[key];
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function preview(value: string): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
}

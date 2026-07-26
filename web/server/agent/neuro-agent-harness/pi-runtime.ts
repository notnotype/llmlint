import type {AssistantMessageEvent} from "@earendil-works/pi-ai";
import type {
    AgentMessage,
    JsonObject,
    JsonValue,
    ModelRuntime,
    ModelRuntimeEvent,
    ModelToolSpec,
    ModelTurnRequest,
} from "@notnotype/neuro-agent-harness";
import {callModelTurn, type AssistantMessage, type AgentTurnContext, type PiTool} from "../../../../evals/generator/model-client";
import type {ResolvedModel} from "../../../../evals/generator/config";

/** llmlint 侧仅传 provider-neutral 的模型选择，不把 Pi 类型泄露进 Core。 */
export interface LlmlintModelConfig extends JsonObject {
    modelKey: string;
    /** 单轮输出安全上限；实际值还会受模型声明 maxTokens 约束。 */
    maxTokensCap: number;
}

export interface LlmlintPiRuntimeOptions {
    readonly resolveModel?: (modelKey: string) => ResolvedModel;
    readonly runTurn?: (model: ResolvedModel, context: AgentTurnContext, maxTokens: number, signal: AbortSignal) => Promise<AssistantMessage>;
}

/** 把 llmlint 当前 Pi 0.75 runtime 接到独立 Harness 的 ModelRuntime Seam。 */
export class LlmlintPiModelRuntime implements ModelRuntime<LlmlintModelConfig> {
    private readonly resolve: (modelKey: string) => ResolvedModel;
    private readonly run: (model: ResolvedModel, context: AgentTurnContext, maxTokens: number, signal: AbortSignal) => Promise<AssistantMessage>;

    constructor(options: LlmlintPiRuntimeOptions = {}) {
        this.resolve = options.resolveModel ?? (() => { throw new Error("llmlint Pi ModelRuntime 缺少 resolveModel Adapter"); });
        this.run = options.runTurn ?? callModelTurn;
    }

    async runTurn(request: ModelTurnRequest<LlmlintModelConfig>) {
        const model = this.resolve(request.modelConfig.modelKey);
        const context: AgentTurnContext = {
            systemPrompt: request.systemPrompt,
            messages: request.messages.map(toPiMessage),
            tools: request.tools.map(toPiTool),
            onEvent: async (event) => {
                const mapped = mapPiEvent(event);
                if (mapped) await request.onEvent?.(mapped);
            },
        };
        const assistant = await this.run(model, context, Math.min(model.maxTokens, request.modelConfig.maxTokensCap), request.signal);
        return {message: fromPiAssistant(assistant)};
    }
}

function toPiMessage(message: AgentMessage): unknown {
    if (message.role === "user") {
        return {role: "user", content: [{type: "text", text: message.content}], timestamp: message.timestamp};
    }
    if (message.role === "assistant") {
        return {
            role: "assistant",
            content: message.content.map((block) => {
                if (block.type === "text") return {type: "text", text: block.text};
                if (block.type === "thinking") return {type: "thinking", thinking: block.thinking};
                return {type: "toolCall", id: block.call.id, name: block.call.name, arguments: block.call.arguments};
            }),
            timestamp: message.timestamp,
            usage: message.usage ? {input: message.usage.input, output: message.usage.output} : undefined,
        };
    }
    return {
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: [{type: "text", text: message.content}],
        isError: message.isError,
        timestamp: message.timestamp,
    };
}

function toPiTool(tool: ModelToolSpec): PiTool {
    return {name: tool.name, description: tool.description, parameters: tool.parameters};
}

function fromPiAssistant(message: AssistantMessage): Extract<AgentMessage, {role: "assistant"}> {
    const content = message.content.flatMap((block): Extract<AgentMessage, {role: "assistant"}>["content"][number][] => {
        if (block.type === "text" && typeof block.text === "string") return [{type: "text", text: block.text}];
        if (block.type === "thinking") {
            const thinking = (block as {thinking?: unknown}).thinking;
            if (typeof thinking === "string") return [{type: "thinking", thinking}];
        }
        if (block.type === "toolCall" && typeof block.name === "string") {
            return [{type: "toolCall", call: {
                id: block.id ?? `tool-call-${Math.random().toString(36).slice(2)}`,
                name: block.name,
                arguments: toJsonValue(block.arguments ?? {}),
            }}];
        }
        return [];
    });
    const input = message.usage?.input ?? 0;
    const output = message.usage?.output ?? 0;
    return {
        role: "assistant",
        content,
        timestamp: Date.now(),
        usage: {input, output, total: input + output},
    };
}

function mapPiEvent(event: AssistantMessageEvent): ModelRuntimeEvent | null {
    if (event.type === "start") return {type: "message_start"};
    if (event.type === "text_delta") return {type: "text_delta", delta: event.delta};
    if (event.type === "thinking_delta") return {type: "thinking_delta", delta: event.delta};
    if (event.type === "toolcall_end") {
        return {
            type: "tool_call_delta",
            toolCallId: event.toolCall.id,
            toolName: event.toolCall.name,
            arguments: toJsonValue(event.toolCall.arguments),
        };
    }
    if (event.type === "done") return {type: "message_end", message: fromPiAssistant(event.message)};
    if (event.type === "error") return {type: "message_end", message: fromPiAssistant(event.error)};
    return null;
}

function toJsonValue(value: unknown): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(toJsonValue);
    if (typeof value === "object") {
        const result: JsonObject = {};
        for (const [key, item] of Object.entries(value)) result[key] = toJsonValue(item);
        return result;
    }
    return String(value);
}

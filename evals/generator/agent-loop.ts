// 通用多轮工具循环（Task 18）：让模型带着工具集对同一份上下文多轮工作——每轮补全 →
// 执行本轮全部工具调用 → 把 toolResult 回喂进消息历史 → 下一轮，直到 terminate 工具 /
// 自然停止 / 轮数耗尽。本文件不含任何业务（web 改写的工具定义与文本状态在调用方）。
//
// 与 model-client 的关系：每轮经 callModelTurn 走同一套 gate/重试/分类（传输错重发同轮，
// auth/溢出/length 终态抛出终止整个 loop）。callTurn 可注入 —— 单测给假实现即可无网测循环骨架
// （照 callWithRetry 的 sleepFn 先例）。
import type {ResolvedModel} from "./config";
import type {AssistantMessage, AgentTurnContext, PiTool} from "./model-client";
import type {AssistantMessageEvent} from "@earendil-works/pi-ai";
import {callModelTurn} from "./model-client";

/** 模型发出的一次工具调用（从 AssistantMessage.content 的 toolCall block 提出）。 */
export type AgentToolCall = {id: string; name: string; arguments: Record<string, unknown>};

/**
 * 一次工具执行的产物：content=回喂给模型的文本（成功提示或**自纠指令**——错误文案要告诉模型怎么改参数重试）；
 * isError=true 时以错误 toolResult 回喂；terminate=true 时本轮执行完即结束整个循环（如 finish 工具）。
 */
export type ToolExecution = {content: string; isError?: boolean; terminate?: boolean};

/** 循环参数。execute 同步即可（文本替换无 I/O）；onTurn 供调用方记日志/进度。 */
export type AgentLoopOptions = {
    system: string;
    /** 首条 user 消息（全文/清单/批注一次性放入，循环中不再追加 user 内容） */
    user: string;
    /** 持久化 Harness 恢复时传完整消息历史；存在时替代默认的单条 user 初始化。 */
    messages?: unknown[];
    tools: PiTool[];
    maxTurns: number;
    maxTokensPerTurn: number;
    /** 执行一次工具调用（未知工具/脏参数也在这里以 isError 回喂，不抛） */
    execute: (call: AgentToolCall) => ToolExecution;
    /** 每轮补全后回调（assistant 原样 + 轮次序号，从 1 起） */
    onTurn?: (assistant: AssistantMessage, turn: number) => void | Promise<void>;
    /** 每次工具执行完成后回调，供 append-only session 持久化与实时事件投影。 */
    onToolResult?: (call: AgentToolCall, execution: ToolExecution, turn: number) => void | Promise<void>;
    onTurnStart?: (turn: number) => void | Promise<void>;
    onMessageEvent?: (event: AssistantMessageEvent, turn: number) => void | Promise<void>;
    onToolStart?: (call: AgentToolCall, turn: number) => void | Promise<void>;
    onToolEnd?: (call: AgentToolCall, execution: ToolExecution, turn: number) => void | Promise<void>;
    onTurnEnd?: (turn: number) => void | Promise<void>;
    /** 外部取消信号；触发后在 provider 与工具边界尽快终止。 */
    signal?: AbortSignal;
    /** 一轮补全的执行器；缺省 callModelTurn，单测注入假实现 */
    callTurn?: (resolved: ResolvedModel, context: AgentTurnContext, maxTokens: number, signal?: AbortSignal) => Promise<AssistantMessage>;
};

/**
 * 循环结束方式：finish=某次工具执行 terminate；natural-stop=模型 stop 且无工具调用
 * （成功与否由业务层按已应用的编辑数裁决）；max-turns=轮数耗尽（业务层可接受局部成果）。
 */
export type AgentLoopResult = {
    stop: "finish" | "natural-stop" | "max-turns";
    /** 实际跑的轮数 */
    turns: number;
    /** 累计工具调用次数（含失败的） */
    toolCalls: number;
    /** 全部轮次 usage 累加（provider 不回报的轮记 0） */
    usage: {input: number; output: number};
    /** 完整 Pi 消息历史，调用方可持久化并在后续 invocation 恢复。 */
    messages: unknown[];
};

// 连续 N 轮所有工具调用全部失败 → 判死循环抛错止损（模型反复用同样的坏参数打转）。
const MAX_CONSECUTIVE_FAILED_TURNS = 3;

/**
 * 跑一个多轮工具循环。抛错的情形：某轮补全终态失败/重试耗尽（callModelTurn 上抛）、
 * 连续 {@link MAX_CONSECUTIVE_FAILED_TURNS} 轮工具全错。其余一律正常返回，由业务层裁决成败。
 */
export async function runAgentLoop(resolved: ResolvedModel, options: AgentLoopOptions): Promise<AgentLoopResult> {
    const callTurn = options.callTurn ?? callModelTurn;
    // 消息历史：user / assistant（原样回填）/ toolResult。形态由本函数构造，model-client 侧收 unknown[]。
    const messages: unknown[] = options.messages
        ? [...options.messages]
        : [{role: "user", content: [{type: "text", text: options.user}], timestamp: Date.now()}];
    let toolCalls = 0;
    let consecutiveFailedTurns = 0;
    const usage = {input: 0, output: 0};
    for (let turn = 1; turn <= options.maxTurns; turn += 1) {
        options.signal?.throwIfAborted();
        await options.onTurnStart?.(turn);
        const assistant = await callTurn(resolved, {
            systemPrompt: options.system,
            messages,
            tools: options.tools,
            onEvent: (event) => options.onMessageEvent?.(event, turn),
        }, options.maxTokensPerTurn, options.signal);
        messages.push(assistant);
        usage.input += assistant.usage?.input ?? 0;
        usage.output += assistant.usage?.output ?? 0;
        await options.onTurn?.(assistant, turn);
        const calls = extractToolCalls(assistant);
        if (calls.length === 0) {
            await options.onTurnEnd?.(turn);
            // stop + 纯文本（或 toolUse 却没解析出调用块的异常形态）：自然收尾，交业务层裁决。
            return {stop: "natural-stop", turns: turn, toolCalls, usage, messages};
        }
        let terminated = false;
        let allFailed = true;
        for (const call of calls) {
            options.signal?.throwIfAborted();
            toolCalls += 1;
            await options.onToolStart?.(call, turn);
            const execution = options.execute(call);
            if (!execution.isError) {
                allFailed = false;
            }
            messages.push({
                role: "toolResult",
                toolCallId: call.id,
                toolName: call.name,
                content: [{type: "text", text: execution.content}],
                isError: execution.isError === true,
                timestamp: Date.now(),
            });
            await options.onToolResult?.(call, execution, turn);
            await options.onToolEnd?.(call, execution, turn);
            if (execution.terminate) {
                terminated = true;
            }
        }
        if (terminated) {
            await options.onTurnEnd?.(turn);
            return {stop: "finish", turns: turn, toolCalls, usage, messages};
        }
        await options.onTurnEnd?.(turn);
        consecutiveFailedTurns = allFailed ? consecutiveFailedTurns + 1 : 0;
        if (consecutiveFailedTurns >= MAX_CONSECUTIVE_FAILED_TURNS) {
            throw new Error(`连续 ${MAX_CONSECUTIVE_FAILED_TURNS} 轮工具调用全部失败，判死循环终止（共 ${toolCalls} 次调用）`);
        }
    }
    return {stop: "max-turns", turns: options.maxTurns, toolCalls, usage, messages};
}

/** 从一轮 assistant 消息里提出全部工具调用。id 缺失（不合规 provider）时兜底生成，保 toolResult 可关联。 */
function extractToolCalls(assistant: AssistantMessage): AgentToolCall[] {
    return (assistant.content ?? [])
        .filter((block) => block.type === "toolCall" && typeof block.name === "string")
        .map((block, index) => ({
            id: block.id ?? `tool-call-${index}`,
            name: block.name!,
            arguments: (block.arguments && typeof block.arguments === "object" ? block.arguments : {}) as Record<string, unknown>,
        }));
}

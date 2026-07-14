// Task 18：AI 改写的 agent 核心——模型经 replace/finish 两工具对一份「工作文本」逐处做局部修改，
// 服务端逐条应用并记录编辑（供前端「编辑条目流」轮询展示），结束后返回最终工作文本。
// full / selection 两模式共用本核心（工作文本分别是整篇草稿 / 选中文本），prompt 组装与守门在 llm-fix.ts。
// 循环骨架在 evals/generator/agent-loop.ts（每轮经 model-client 的 gate/重试）。
import {Type} from "typebox";
import {runAgentLoop, type AgentToolCall, type ToolExecution} from "evals-generator/agent-loop";
import type {ResolvedModel} from "evals-generator/config";

/** 一条已应用的编辑（前端编辑条目流的最小单元）。reason 缺省 = 模型没给理由。 */
export type LlmFixEdit = {oldText: string; newText: string; reason?: string};

// replace 工具：一次改一处。oldText 唯一性由 applyReplace 校验，失败以自纠指令回喂。
const REPLACE_TOOL = {
    name: "replace",
    description: "把正文中一处原文片段替换为改写后的文本。oldText 必须原样摘自当前正文且在全文中唯一；一次调用只改一处，改动尽量小。",
    parameters: Type.Object({
        oldText: Type.String({description: "原样摘录的原文片段（须全文唯一；不唯一时扩大摘录范围带上前后文）"}),
        newText: Type.String({description: "替换后的文本"}),
        reason: Type.Optional(Type.String({description: "一句话修改理由"})),
    }, {additionalProperties: false}),
};

// finish 工具：全部修改完成后调用，结束循环。
const FINISH_TOOL = {
    name: "finish",
    description: "全部修改完成后调用，结束改写。",
    parameters: Type.Object({summary: Type.Optional(Type.String({description: "一句话修改概要"}))}, {additionalProperties: false}),
};

/**
 * 对工作文本应用一次精确替换（纯函数，可单测）。失败的 error 文案即回喂模型的**自纠指令**：
 * 未命中 → 提示原样摘录；多命中 → 提示扩大摘录范围。
 */
export function applyReplace(working: string, oldText: string, newText: string): {ok: true; next: string} | {ok: false; error: string} {
    if (oldText.length === 0) {
        return {ok: false, error: "oldText 为空。请原样摘录一段要修改的正文。"};
    }
    if (oldText === newText) {
        return {ok: false, error: "oldText 与 newText 相同，没有产生修改。请给出真正改写后的文本。"};
    }
    const first = working.indexOf(oldText);
    if (first === -1) {
        return {ok: false, error: "oldText 未在正文中找到。请原样摘录正文片段（注意标点与空白），不要改写后再摘。"};
    }
    let count = 1;
    let cursor = first + oldText.length;
    while (count < 2) {
        const next = working.indexOf(oldText, cursor);
        if (next === -1) {
            break;
        }
        count += 1;
        cursor = next + oldText.length;
    }
    if (count > 1) {
        return {ok: false, error: "oldText 在正文中命中多处。请扩大摘录范围、带上前后文，使其唯一。"};
    }
    return {ok: true, next: working.slice(0, first) + newText + working.slice(first + oldText.length)};
}

/** 改写 agent 的运行参数。onEdit 每应用一条编辑回调一次（llm-fix.ts 用它同步写 job.edits 供轮询）。 */
export type RewriteAgentOptions = {
    model: ResolvedModel;
    system: string;
    /** 首条 user 消息（llm-fix.ts 组装：full=正文+清单+批注 / selection=选区+上下文+批注，收尾指令为工具口径） */
    user: string;
    /** 初始工作文本（full=整篇草稿 / selection=选中文本） */
    working: string;
    maxEdits: number;
    maxTurns: number;
    maxTokensPerTurn: number;
    onEdit?: (edit: LlmFixEdit) => void;
    /** 日志前缀（如 "job=xxx mode=full"） */
    label: string;
};

/** 改写 agent 的产物：最终工作文本 + 已应用的编辑序列 + 结束方式。 */
export type RewriteAgentResult = {working: string; edits: LlmFixEdit[]; stop: "finish" | "natural-stop" | "max-turns"};

/**
 * 跑一次改写 agent。**不做成败裁决**——0 edits 是否算失败、max-turns 是否接受局部成果，
 * 由调用方（llm-fix.ts 的两模式守门）决定。本函数只保证：返回的 working 恰是 edits 依序应用的结果。
 */
export async function runRewriteAgent(options: RewriteAgentOptions): Promise<RewriteAgentResult> {
    let working = options.working;
    const edits: LlmFixEdit[] = [];
    const execute = (call: AgentToolCall): ToolExecution => {
        if (call.name === "finish") {
            const summary = typeof call.arguments.summary === "string" ? call.arguments.summary : "";
            console.debug(`[llm-fix] ${options.label} finish：${summary.slice(0, 120)}`);
            return {content: "已结束改写。", terminate: true};
        }
        if (call.name !== "replace") {
            return {content: `未知工具 ${call.name}。只能使用 replace 和 finish。`, isError: true};
        }
        const oldText = call.arguments.oldText;
        const newText = call.arguments.newText;
        if (typeof oldText !== "string" || typeof newText !== "string") {
            return {content: "replace 参数不合法：oldText 与 newText 都必须是字符串。", isError: true};
        }
        // 编辑数封顶：不再应用新替换，提示模型收尾（不算错误——模型行为正常，是我们主动截停）。
        if (edits.length >= options.maxEdits) {
            return {content: `已达修改数量上限（${options.maxEdits} 处），本次替换未应用。请调用 finish 结束。`};
        }
        const applied = applyReplace(working, oldText, newText);
        if (!applied.ok) {
            return {content: applied.error, isError: true};
        }
        working = applied.next;
        const reason = typeof call.arguments.reason === "string" && call.arguments.reason.length > 0 ? call.arguments.reason : undefined;
        const edit: LlmFixEdit = reason === undefined ? {oldText, newText} : {oldText, newText, reason};
        edits.push(edit);
        options.onEdit?.(edit);
        return {content: `已应用第 ${edits.length} 处替换。请继续下一处，全部完成后调用 finish。`};
    };
    const result = await runAgentLoop(options.model, {
        system: options.system,
        user: options.user,
        tools: [REPLACE_TOOL, FINISH_TOOL],
        maxTurns: options.maxTurns,
        maxTokensPerTurn: options.maxTokensPerTurn,
        execute,
        onTurn: (assistant, turn) => {
            console.debug(`[llm-fix] ${options.label} 第 ${turn} 轮 stopReason=${assistant.stopReason ?? "?"} 已应用=${edits.length} 处`);
        },
    });
    console.info(`[llm-fix] ${options.label} agent 结束：${result.stop}，${result.turns} 轮 / ${result.toolCalls} 次工具调用 / ${edits.length} 处编辑，tokens=${result.usage.input}+${result.usage.output}`);
    return {working, edits, stop: result.stop};
}

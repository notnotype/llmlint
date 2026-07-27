// eval-writer v1：照剧情纲写一章正文。单次 completion,**不喂任何文风范本/示例** —— 取模型最原始的写作嗓音。
// prompt 本体迁到 generator/prompts.ts（版本化注册表，守 I8）；本文件只做调用编排。
import {callModelDetailed, type AnyModel, type CallResult} from "./model-client";
import {renderPrompt, renderSystem, DEFAULT_PROMPT_VERSIONS} from "./prompts";
import {GENRES, taxonomyLabel} from "../lib/taxonomy";

/** 题材 key → 中文标签（值集单一真相源 = lib/taxonomy.ts；未知 key 原样返回）。 */
export function genreLabel(slug: string): string {
    return taxonomyLabel(GENRES, slug);
}

/**
 * 剧情纲 → 一章 AI 正文（带 usage）。promptVersion 缺省用当前默认 render 版本。
 *
 * @param ctx.constraints 写作期约束正文（`llmlint guide` 输出）。仅 render-v2 起作用；
 *   缺省或空串时系统提示词与 v1 逐字节相同。
 */
export async function renderDetailed(briefText: string, ctx: {genre: string; targetChars: number; constraints?: string}, model: AnyModel, promptVersion: string = DEFAULT_PROMPT_VERSIONS.render): Promise<CallResult> {
    const preset = renderPrompt(promptVersion);
    const system = renderSystem(preset, ctx.targetChars, ctx.constraints ?? "");
    const user = `【题材】${genreLabel(ctx.genre)}\n\n【剧情纲】\n${briefText}\n\n请据此写出本章正文。`;
    // maxTokens 16000：推理模型(如 doubao-seed-2-1-pro)会先烧大量 thinking token,8000 常在思考阶段就被截断
    // (stopReason=length、可见正文≈0);给足预算让它思考完还能写出整章。非推理模型不受影响(自然 end_turn)。
    return callModelDetailed(model, system, user, 16000);
}

/** 剧情纲 → 一章 AI 正文（历史签名，只要文本）。 */
export async function render(briefText: string, ctx: {genre: string; targetChars: number}, model: AnyModel, promptVersion?: string): Promise<string> {
    return (await renderDetailed(briefText, ctx, model, promptVersion)).text;
}

// eval-writer v1：照剧情纲写一章正文。单次 completion,**不喂任何文风范本/示例** —— 取模型最原始的写作嗓音。
// prompt 本体迁到 generator/prompts.ts（版本化注册表，守 I8）；本文件只做调用编排。
import {callModelDetailed, type AnyModel, type CallResult} from "./model-client";
import {renderPrompt, DEFAULT_PROMPT_VERSIONS} from "./prompts";

const GENRE_LABELS: Record<string, string> = {
    xuanhuan: "玄幻",
    "light-novel": "轻小说",
    xianxia: "仙侠修真",
    dushi: "都市",
    guyan: "古代言情",
    xianyan: "现代言情",
    kehuan: "科幻",
    xuanyi: "悬疑",
    lishi: "历史",
    literary: "严肃文学",
    // task08 新题组
    wuxia: "武侠",
    gongdou: "宫斗",
    wuxianliu: "无限流",
};

export function genreLabel(slug: string): string {
    return GENRE_LABELS[slug] ?? slug;
}

/** 剧情纲 → 一章 AI 正文（带 usage）。promptVersion 缺省用当前默认 render 版本。 */
export async function renderDetailed(briefText: string, ctx: {genre: string; targetChars: number}, model: AnyModel, promptVersion: string = DEFAULT_PROMPT_VERSIONS.render): Promise<CallResult> {
    const preset = renderPrompt(promptVersion);
    const system = preset.system.replace("{TARGET}", String(ctx.targetChars));
    const user = `【题材】${genreLabel(ctx.genre)}\n\n【剧情纲】\n${briefText}\n\n请据此写出本章正文。`;
    // maxTokens 16000：推理模型(如 doubao-seed-2-1-pro)会先烧大量 thinking token,8000 常在思考阶段就被截断
    // (stopReason=length、可见正文≈0);给足预算让它思考完还能写出整章。非推理模型不受影响(自然 end_turn)。
    return callModelDetailed(model, system, user, 16000);
}

/** 剧情纲 → 一章 AI 正文（历史签名，只要文本）。 */
export async function render(briefText: string, ctx: {genre: string; targetChars: number}, model: AnyModel, promptVersion?: string): Promise<string> {
    return (await renderDetailed(briefText, ctx, model, promptVersion)).text;
}

// brief 抽取 v2：从一章人类正文抽"剧情纲",供模型据此重写。
// 承重纪律：详化的是"发生了什么"(内容级),严禁"怎么写的"(文体级) —— 句子级风格/修辞/原文措辞一律不进,
// 否则把人类文风泄漏进 AI render、压低 lift。判别 tell 是文体级的,详化剧情内容反而更好地控住配对。
// prompt 本体迁到 generator/prompts.ts（版本化注册表，守 I8）；本文件只做调用编排。
import {callModelDetailed, type AnyModel, type CallResult} from "./model-client";
import {briefPrompt, DEFAULT_PROMPT_VERSIONS} from "./prompts";

/** 一章正文 → 详细剧情纲（带 usage）。promptVersion 缺省用当前默认 brief 版本。 */
export async function extractBriefDetailed(referenceText: string, extractor: AnyModel, promptVersion: string = DEFAULT_PROMPT_VERSIONS.brief): Promise<CallResult> {
    const preset = briefPrompt(promptVersion);
    return callModelDetailed(extractor, preset.system, `【本章正文】\n${referenceText}`, 4000);
}

/** 一章正文 → 详细剧情纲文本（历史签名，只要文本）。 */
export async function extractBrief(referenceText: string, extractor: AnyModel, promptVersion?: string): Promise<string> {
    return (await extractBriefDetailed(referenceText, extractor, promptVersion)).text;
}

// prompt 版本化注册表（守 I8：prompt 是版本化资产，改动必须新增版本 key，不许原地改）。
// brief/render 的 prompt 统一在这里登记；每个 render sample 记录自己的 promptVersion，
// 消费侧发现缺版本或跨版本时直接拒绝生成报告。

export type PromptPreset = {
    /** 版本 key（如 brief-v2）：唯一、不可变；调 prompt = 加新 key */
    key: string;
    system: string;
};

// ── brief 抽取 prompt ──
// v2：详化剧情信息量（场景/人物目标关系/细粒度节拍/对话要点/信息时序/情绪），仍守"不带文体"红线（I1）。
const BRIEF_V2: PromptPreset = {
    key: "brief-v2",
    system: `你是剧情拆解助手。读者会给你一章小说正文,你只输出这一章详细的"剧情纲",供另一个模型据此重写出内容等价的一章。剧情纲要足够详细,让重写者不必猜测就能还原每个情节、人物动机和信息节奏。

严格要求：
- 详细记录**剧情内容**：场景与地点的具体设定、每个出场人物的身份/目标/彼此关系与立场、事件按发生顺序的**细粒度**节拍(每个关键动作、转折、因果都列出)、关键对话的**内容要点**(说了什么意思,不照抄原句)、信息与悬念的揭示时序、人物情绪的变化与转折点、本章叙述视角(第一/第三人称)。
- **绝对禁止**描述或复现文体：不照抄或复述原文句子,不描述文笔/修辞/用词/句式/节奏/描写手法,不加入任何描写性、比喻性或渲染性的语言。只说"发生了什么、谁想要什么、透露了什么",不说"作者怎么写的"。
- 用分层要点列出,信息密集但每条是朴素陈述句,不要写成正文。

输出格式：
题材视角：<一行,如"第三人称,玄幻">
人物：<每人一行:名字 - 身份/目标/与他人关系>
节拍：<有序列表,尽量细,每条一句话说清发生了什么(含关键对话要点、动作、转折、因果)>
信息控制：<读者此刻知道什么、悬念是什么、本章揭示了什么新信息>
情绪走向：<主要人物的情绪起点→转折→落点>`,
};

// ── render prompt ──
// v1：刻意不给文风指引（I2 baseline 不喂文风范本），只给剧情 + 题材 + 篇幅。{TARGET} 占位符 = 目标字数。
const RENDER_V1: PromptPreset = {
    key: "render-v1",
    system: `你是网络小说写手。根据给定的"剧情纲"写出这一章的完整正文。

要求：
- 严格遵循剧情纲的人物、节拍、叙述视角和信息控制。
- 写成连贯的小说正文,不要标题、不要小标题、不要作者的话、不要任何说明或 markdown 标记,直接输出正文本身。
- 不要照抄剧情纲的措辞,把它展开成有血有肉的正文。
- 目标篇幅约 {TARGET} 字。`,
};

export const BRIEF_PROMPTS: Record<string, PromptPreset> = {
    [BRIEF_V2.key]: BRIEF_V2,
};

export const RENDER_PROMPTS: Record<string, PromptPreset> = {
    [RENDER_V1.key]: RENDER_V1,
};

/** 当前默认版本（eval.config 未指定时用）。历史语料（round-04/05 生成）即按这两个版本生成。 */
export const DEFAULT_PROMPT_VERSIONS = {brief: BRIEF_V2.key, render: RENDER_V1.key} as const;

/** 取 brief prompt，未知版本直接抛（宁可失败不可静默换 prompt——I8）。 */
export function briefPrompt(key: string): PromptPreset {
    const preset = BRIEF_PROMPTS[key];
    if (!preset) {
        throw new Error(`未知 brief prompt 版本：${key}（可用：${Object.keys(BRIEF_PROMPTS).join(", ")}）`);
    }
    return preset;
}

/** 取 render prompt，未知版本直接抛。 */
export function renderPrompt(key: string): PromptPreset {
    const preset = RENDER_PROMPTS[key];
    if (!preset) {
        throw new Error(`未知 render prompt 版本：${key}（可用：${Object.keys(RENDER_PROMPTS).join(", ")}）`);
    }
    return preset;
}

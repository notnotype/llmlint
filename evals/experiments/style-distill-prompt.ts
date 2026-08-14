import {Type} from "typebox";

/** 文风蒸馏提示词版本。修改任一提示词必须新增版本，不得原地改写。 */
export const STYLE_DISTILL_PROMPT_VERSION = "style-distill-v1";

/** 蒸馏时分别观察的文风维度，避免把剧情事实误当成文风规则。 */
export const STYLE_DISTILL_DIMENSIONS = [
    "句式与节奏",
    "段落与排版",
    "词汇与意象",
    "视角与信息控制",
    "情绪与叙事",
    "对话与动作",
    "修辞与陌生化",
    "场景触发特征",
] as const;

/** 单篇参考正文的结构化分析工具。工具输出不允许抄录原文。 */
export const ANALYZE_STYLE_TOOL = {
    name: "report_style_analysis",
    description: "报告单篇参考正文中可迁移的文风特征；只描述规律，不摘录原句，不复述专名、情节或世界观事实。",
    parameters: Type.Object({
        sentenceRhythm: Type.Array(Type.String(), {description: "句长变化、停顿、句式组合等稳定特征；每项是可执行的观察。"}),
        paragraphStructure: Type.Array(Type.String(), {description: "段落长度、分行、对白段落和信息落点等特征。"}),
        dictionImagery: Type.Array(Type.String(), {description: "词汇密度、具体物件、意象关系、抽象词使用等特征；不复述专名。"}),
        viewpointInformation: Type.Array(Type.String(), {description: "叙事视角、感知边界、信息揭示顺序等特征。"}),
        emotionNarration: Type.Array(Type.String(), {description: "情绪推进、收束、内心与行动的关系等特征。"}),
        dialogueAction: Type.Array(Type.String(), {description: "对白长度、潜台词、动作承接、说话人区分等特征。"}),
        rhetoricNovelty: Type.Array(Type.String(), {description: "比喻、拟人、错位、陌生化等修辞的使用条件和节制方式。"}),
        sceneFeatures: Type.Array(Type.Object({
            tags: Type.Array(Type.String()),
            whenToUse: Type.String(),
            behavior: Type.String(),
        }, {additionalProperties: false}), {description: "适用场景标签与对应行为；标签必须是通用场景，不得出现原作专名。"}),
        stableSignals: Type.Array(Type.String(), {description: "最值得跨样本复用的稳定信号；不超过 8 项。"}),
        avoidSignals: Type.Array(Type.String(), {description: "从该篇参考中推断出的过度使用风险或应避免的仿写方式；不超过 8 项。"}),
    }, {additionalProperties: false}),
};

/** 多篇分析汇总后的可执行 writer style 工具。 */
export const SYNTHESIZE_STYLE_TOOL = {
    name: "report_distilled_style",
    description: "输出可供 NeuroBook writer 使用的通用文风预设；不复刻参考作品，不带专名、情节、原句或来源信息。",
    parameters: Type.Object({
        label: Type.String({description: "简短的人类可读文风名称，不包含作者名、书名或角色名。"}),
        suggestedKey: Type.String({description: "小写 kebab-case key，只能包含 a-z、0-9、连字符。"}),
        sceneTags: Type.Array(Type.String(), {description: "通用场景标签，最多 8 个。"}),
        whenToUse: Type.String({description: "一句话说明适合什么写作场景，不提参考来源。"}),
        coreRules: Type.Array(Type.String(), {description: "跨样本稳定且可执行的核心规则，按优先级排序，最多 12 条。"}),
        prohibitions: Type.Array(Type.String(), {description: "明确禁区，最多 12 条；必须能通过行为检查。"}),
        styleMarkdown: Type.String({description: "完整 Markdown 文风预设，必须包含文体定位、叙事视角、句式节奏、段落结构、对话、情绪/修辞、正确示例、错误示例、核心禁区和生成自检。示例必须原创且不含参考作品专名、情节或可识别原句。"}),
    }, {additionalProperties: false}),
};

/** 分析阶段的 system prompt；正文只作为研究输入，不允许被当作可复用片段。 */
export const ANALYZE_STYLE_SYSTEM = `你是中文小说文风研究员。你会收到一篇参考正文和一个匿名样本编号。

你的任务是提取可迁移的写作行为，供另一个模型合成为通用 writer 文风规则。只研究“怎么写”，不要复述“写了什么”。

严格边界：
- 不要输出原文句子、连续短语、对白、专名、角色名、地名、组织名、道具名、章节事件或世界观事实。
- 不要用“某作者/这本书很……”作文学评论；每项都要改写成写作者可以执行的行为规则。
- 区分稳定文风信号与仅由本篇剧情、题材或角色造成的偶然特征；偶然特征不要进入 stableSignals。
- 场景特征只能使用通用标签，例如“近身冲突”“日常对话”“信息揭示”“情绪转折”，不得使用原作专名。
- 既记录有效做法，也记录容易过量后变成套路的风险。拿不准时留空，不猜。

请直接调用 report_style_analysis 工具，不要输出普通文本。`;

/** 汇总阶段的 system prompt；输入只有匿名分析，不再把版权正文送入汇总调用。 */
export const SYNTHESIZE_STYLE_SYSTEM = `你是 NeuroBook 的 writer 文风预设编辑。你会收到多篇参考正文的匿名结构化文风分析。

请把跨样本稳定信号合成为一份可执行、可迁移、不过度复刻任何单一来源的 Markdown 文风预设。

硬性要求：
- 只保留跨样本稳定的写作行为；单篇题材、角色、世界观、情节和专属口头禅不得进入产物。
- 不得出现作者名、书名、角色名、地名、组织名、道具名、章节编号、来源路径、样本编号或参考原句。
- 规则必须能指导模型采取动作或避免动作，不能只写“文笔优美”“有画面感”这类空泛评价。
- 必须给出正反行为对照；正确示例和错误示例都要原创，不能改写或拼接参考正文。
- 不要把规则库命中词当成绝对禁词；优先描述语境、节制和替代动作。
- 产物面向常见中文网络小说题材，遇到题材差异时优先保留叙事合同，不强行复制题材表面。
- 文风可有鲜明倾向，但不能牺牲剧情保真、人物声音、因果、信息控制或合理篇幅。

请直接调用 report_distilled_style 工具，不要输出普通文本。`;

/** 构造单篇分析的用户消息。 */
export function buildStyleAnalysisUser(sampleKey: string, body: string, maxChars: number): string {
    return `【匿名样本】${sampleKey}\n【研究维度】${STYLE_DISTILL_DIMENSIONS.join("、")}\n【正文（仅供分析，不得摘录）】\n${boundedExcerpt(body, maxChars)}`;
}

/** 构造汇总用户消息；调用方应先按 sampleKey 排序，保证输入顺序不影响合同。 */
export function buildStyleSynthesisUser(analyses: readonly StyleAnalysis[]): string {
    const payload = analyses.map((analysis) => ({
        sampleKey: analysis.sampleKey,
        sentenceRhythm: analysis.sentenceRhythm,
        paragraphStructure: analysis.paragraphStructure,
        dictionImagery: analysis.dictionImagery,
        viewpointInformation: analysis.viewpointInformation,
        emotionNarration: analysis.emotionNarration,
        dialogueAction: analysis.dialogueAction,
        rhetoricNovelty: analysis.rhetoricNovelty,
        sceneFeatures: analysis.sceneFeatures,
        stableSignals: analysis.stableSignals,
        avoidSignals: analysis.avoidSignals,
    }));
    return `【匿名文风分析集合】\n${JSON.stringify(payload, null, 2)}\n\n请只依据跨样本稳定信号合成预设。`;
}

export type StyleSceneFeature = {
    tags: string[];
    whenToUse: string;
    behavior: string;
};

export type StyleAnalysis = {
    sampleKey: string;
    sentenceRhythm: string[];
    paragraphStructure: string[];
    dictionImagery: string[];
    viewpointInformation: string[];
    emotionNarration: string[];
    dialogueAction: string[];
    rhetoricNovelty: string[];
    sceneFeatures: StyleSceneFeature[];
    stableSignals: string[];
    avoidSignals: string[];
};

export type DistilledStyleOutput = {
    label: string;
    suggestedKey: string;
    sceneTags: string[];
    whenToUse: string;
    coreRules: string[];
    prohibitions: string[];
    styleMarkdown: string;
};

function boundedExcerpt(body: string, maxChars: number): string {
    const chars = [...body];
    if (chars.length <= maxChars) {
        return body;
    }
    const first = Math.max(1, Math.floor(maxChars * 0.72));
    const last = Math.max(1, maxChars - first);
    return `${chars.slice(0, first).join("")}\n\n[中段省略，仅用于控制分析输入长度]\n\n${chars.slice(-last).join("")}`;
}

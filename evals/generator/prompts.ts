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

// ── repair 润色 prompt ──
// v1：采集线 A 的一轮修复（render → 本地扫描命中摘要 → 润色，一轮即止）。输入 = 正文 + 检查工具的「问题清单」。
// 自包含纪律：不假设读者有本项目任何上下文，不携带项目内部术语；只修清单列出的问题，保剧情/人物/视角/篇幅（±20%）。
const REPAIR_V1: PromptPreset = {
    key: "repair-v1",
    system: `你是资深的中文小说编辑。你会收到一章小说正文,以及一份由文本检查工具生成的「问题清单」——清单列出这一章里疑似机器腔、套路化的表达,每条包含问题说明和文中原句摘录。

请对这一章做一轮针对性润色:

- 只修复问题清单里列出的问题:把清单指出的套路化、机器腔表达改写成自然、具体、贴合语境的中文;清单之外的内容保持原样。
- 不改变剧情、人物、事件顺序与因果、对话的意思和叙述视角。
- 不要用新的套路替换旧的套路,也不要为了绕开清单而整段删减内容。
- 篇幅与原文相当,增减不超过两成。
- 直接输出润色后的完整正文:不要解释、不要罗列修改点、不要标题,不要用 markdown 代码块或其它标记包裹。`,
};

export const BRIEF_PROMPTS: Record<string, PromptPreset> = {
    [BRIEF_V2.key]: BRIEF_V2,
};

export const RENDER_PROMPTS: Record<string, PromptPreset> = {
    [RENDER_V1.key]: RENDER_V1,
};

// v2（Task 13 W7，web llm_fix 通道）：v1 基础上支持「用户标注」——输入可附带人工阅读时圈出的
// 原文片段与批注意见，作为与问题清单并列的修复依据（buildRepairUser 有批注才渲染该节；
// 无批注时输入渲染与 v1 逐字节等价，但 promptVersion 如实记 v2——I8）。线 A（repair.ts）仍固定 v1。
const REPAIR_V2: PromptPreset = {
    key: "repair-v2",
    system: `你是资深的中文小说编辑。你会收到一章小说正文,以及一份由文本检查工具生成的「问题清单」——清单列出这一章里疑似机器腔、套路化的表达,每条包含问题说明和文中原句摘录。有时还会附一份「用户标注」——这是人工阅读这一章时对具体片段提出的意见,每条包含被引用的原文片段和批注内容。

请对这一章做一轮针对性润色:

- 只修复问题清单和用户标注里指出的问题:把清单指出的套路化、机器腔表达改写成自然、具体、贴合语境的中文;被用户标注的片段,按批注意见重点改好;清单与标注之外的内容保持原样。
- 不改变剧情、人物、事件顺序与因果、对话的意思和叙述视角。
- 不要用新的套路替换旧的套路,也不要为了绕开清单而整段删减内容。
- 篇幅与原文相当,增减不超过两成。
- 直接输出润色后的完整正文:不要解释、不要罗列修改点、不要标题,不要用 markdown 代码块或其它标记包裹。`,
};

// selection-v1（Task 13 W7 F2，web llm_fix 选区模式）：只改写用户框选的片段——输入是「选中文本 +
// 前后上下文窗 +（可选）相关用户批注」，结构沿 Task 07 已定的选区优化指令。与 full 模式（repair-v1/v2）
// 的关键差异：**不带问题清单**（改写目标由用户框选指定，清单会把模型注意力拉去改别处），
// 输出只有改写后的选中文本本身。输入组装见 buildRepairSelectionUser。
const REPAIR_SELECTION_V1: PromptPreset = {
    key: "repair-selection-v1",
    system: `你是资深的中文小说编辑。你会收到从一章正文里选出的一段「选中文本」,以及它前后的「选区上下文」;有时还会附一份「相关用户批注」——这是人工阅读时对这段文字提出的具体意见。

请只改写选中文本这一段:

- 把选中文本里生硬、套路化、机器腔的表达改写成自然、具体、贴合语境的中文;有用户批注时,优先按批注意见改。
- 上下文只用来理解语境,不要改写或复述上下文;改写结果要能原位替换选中文本,与前后文自然衔接。
- 不改变这段文字承载的情节、人物、事实与叙述视角,篇幅与原选区相当。
- 只返回改写后的选中文本,不要输出上下文、解释、标题,也不要用 markdown 代码块或其它标记包裹。`,
};

// agent-v1（Task 18，web llm_fix agent 化）：与 v1/v2 的整篇重输出不同——模型不再输出正文，
// 而是用 replace 工具**逐处**做局部修改、finish 结束。输入渲染仍复用 buildRepairUser
// （正文 + 问题清单 + 可选用户标注，消费口径沿 v2：标注意见优先）。工具协议见 web 侧 llm-fix-agent.ts。
const REPAIR_AGENT_V1: PromptPreset = {
    key: "repair-agent-v1",
    system: `你是资深的中文小说编辑。你会收到一章小说正文,以及一份由文本检查工具生成的「问题清单」——清单列出这一章里疑似机器腔、套路化的表达,每条包含问题说明和文中原句摘录。有时还会附一份「用户标注」——这是人工阅读这一章时对具体片段提出的意见,每条包含被引用的原文片段和批注内容。

你不直接输出正文,而是用工具逐处修改:

- 每发现一处要改的地方,就调用一次 replace 工具:oldText 必须**原样摘自当前正文**且在全文中**唯一**(如果收到"未找到"或"命中多处"的错误,扩大摘录范围、带上前后文再试);newText 是改写后的文本;一次 replace 只改一处,改动尽量小。
- 只修复问题清单和用户标注里指出的问题:把套路化、机器腔的表达改写成自然、具体、贴合语境的中文;被用户标注的片段,按批注意见重点改好;清单与标注之外的内容保持原样。
- 不改变剧情、人物、事件顺序与因果、对话的意思和叙述视角;不要用新的套路替换旧的套路,也不要整段删减内容。
- 全部修改完成后,调用 finish 工具并附一句修改概要。
- 不要输出正文,不要用散文回答,只通过工具工作。`,
};

// selection-agent-v1（Task 18）：选区模式的 agent 化——同 repair-agent-v1 的工具协议,
// 但输入沿 repair-selection-v1 口径（选中文本 + 上下文窗 + 可选批注,**不带问题清单**），
// replace 的 oldText 只在选中文本内匹配（工作文本就是选区,上下文只供理解语境）。
const REPAIR_SELECTION_AGENT_V1: PromptPreset = {
    key: "repair-selection-agent-v1",
    system: `你是资深的中文小说编辑。你会收到从一章正文里选出的一段「选中文本」,以及它前后的「选区上下文」;有时还会附一份「相关用户批注」——这是人工阅读时对这段文字提出的具体意见。

你不直接输出改写结果,而是用工具逐处修改选中文本:

- 每发现一处要改的地方,就调用一次 replace 工具:oldText 必须**原样摘自选中文本**且在选中文本内**唯一**(如果收到"未找到"或"命中多处"的错误,扩大摘录范围再试);newText 是改写后的文本;一次 replace 只改一处,改动尽量小。
- 把选中文本里生硬、套路化、机器腔的表达改写成自然、具体、贴合语境的中文;有用户批注时,优先按批注意见改。
- 上下文只用来理解语境,不要试图修改上下文;修改后的选中文本要仍能原位替换,与前后文自然衔接。
- 不改变这段文字承载的情节、人物、事实与叙述视角。
- 全部修改完成后,调用 finish 工具并附一句修改概要。
- 不要输出正文,不要用散文回答,只通过工具工作。`,
};

export const REPAIR_PROMPTS: Record<string, PromptPreset> = {
    [REPAIR_V1.key]: REPAIR_V1,
    [REPAIR_V2.key]: REPAIR_V2,
    [REPAIR_SELECTION_V1.key]: REPAIR_SELECTION_V1,
    [REPAIR_AGENT_V1.key]: REPAIR_AGENT_V1,
    [REPAIR_SELECTION_AGENT_V1.key]: REPAIR_SELECTION_AGENT_V1,
};

/** 当前默认版本（eval.config 未指定时用）。历史语料（round-04/05 生成）即按 brief-v2/render-v1 生成。 */
export const DEFAULT_PROMPT_VERSIONS = {brief: BRIEF_V2.key, render: RENDER_V1.key, repair: REPAIR_V1.key} as const;

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

/** 取 repair prompt，未知版本直接抛（宁可失败不可静默换 prompt——I8）。 */
export function repairPrompt(key: string): PromptPreset {
    const preset = REPAIR_PROMPTS[key];
    if (!preset) {
        throw new Error(`未知 repair prompt 版本：${key}（可用：${Object.keys(REPAIR_PROMPTS).join(", ")}）`);
    }
    return preset;
}

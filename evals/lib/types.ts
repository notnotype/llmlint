// 消费侧本地类型。corpus → scan → metrics → report 共用。
export type SampleRole = "reference" | "render" | "repair";

/** 语料里一篇正文 + 其元数据。reference=人类类，render/repair=AI 类。 */
export type Sample = {
    role: SampleRole;
    genre: string;
    plotId: string;
    model?: string;
    modelVersion?: string;
    styleKey?: string;
    difficulty?: string;
    split?: "train" | "test";
    referenceSource?: string;
    pairRef?: string; // render 指向的本章 reference 文件名（逐章 1:1 配对键）；repair 沿用源 render 的值；reference 无
    repairOf?: string; // repair 指向的源 render 文件名（before/after 配对键，report.repair 消费）；其它 role 无
    file: string;
    absPath: string;
    text: string;
    charCount: number; // 可见字数（去空白），消费侧自算，是 fireRate 的分母口径
};

/** 单篇扫描结果。 */
export type SampleScan = {
    sample: Sample;
    rawHitsByRule: Map<string, number>; // ruleId → 原始命中数（per-rule lift 口径）
    dedupSpanCount: number;             // 去重 span 数（文档负担口径，docScore/检测器/排名消费）
    agentRawHits: number;               // review==="agent" 的原始命中合计（误杀率口径消费）
};

/** 规则某一分层（模型 / 题材）的率与 lift。byModel、byGenre 共用。 */
export type StratRate = {lift: number | null; aiRate: number; humanRate: number};

/** 规则在判别上的统计（lift 体检表一行）。 */
export type RuleStat = {
    id: string;
    namespace: string;
    review: string;
    level: string;
    humanRate: number; // 人类侧中位 fireRate（/1000 字）
    aiRate: number;    // AI 侧中位 fireRate
    lift: number | null;          // rate 口径 lift（中位率之比，含 α 平滑）
    humanFireFrac: number;        // 人类侧命中≥1 的文档占比（prevalence）
    aiFireFrac: number;           // AI 侧命中≥1 的文档占比
    prevalenceLift: number | null; // (aiFrac+β)/(humanFrac+β)：稀疏但 AI-only 的判别器靠它浮现
    effectiveLift: number | null;  // max(lift, prevalenceLift)：裁决与排序口径（取较强桶）
    pairsAiGreater: number; // 逐章 1:1 配对里 AI 率 > 人类率 的数量（pairRef 匹配）
    pairsTotal: number;
    humanHits: number;
    aiHits: number;
    verdict: "strong" | "weak" | "noise" | "anti" | "insufficient";
    byModel: Record<string, StratRate>;
    byGenre: Record<string, StratRate>; // 分题材率/ lift，用于跨题材一致性
};

export type DetectorStat = {
    auc: number | null;            // AI vs 人类 的 docScore（去重 span/千字）ROC-AUC
    humanMedianScore: number;      // 人类侧 docScore 中位（去重 span/千字）
    aiMedianScore: number;         // AI 侧 docScore 中位
    humanAgentFalseRate: number;   // 人类侧 agent 桶误杀率中位（命中/千字）= 干净人类正文上的噪声底
    aiAgentRate: number;           // AI 侧 agent 桶命中率中位（命中/千字），作对照
    humanCount: number;
    aiCount: number;
};

export type ModelRank = {
    model: string;
    medianScore: number; // docScore 中位数，越低越像人
    sampleCount: number;
};

/** holdout 泛化校验：按题组确定性切 train/test，verdict 只在 train 定，两侧各报 AUC。 */
export type HoldoutStat = {
    ratio: number;       // 请求的 test 占比
    trainGroups: number; // train 题组数
    testGroups: number;  // test 题组数
    trainAuc: number | null; // train 侧 docScore ROC-AUC（拟合基线）
    testAuc: number | null;  // test 侧 docScore ROC-AUC（泛化：接近 train 说明分离稳、非过拟某几组）
};

export type OverlapPair = {
    leftRuleId: string;
    rightRuleId: string;
    sameSpanHits: number;
    leftOverlapRate: number;
    rightOverlapRate: number;
};

/** 规则同 span 重叠统计；用于发现重复 detector，不改变 docScore 的既有去重口径。 */
export type OverlapStat = {
    rawHits: number;
    uniqueSpans: number;
    duplicateRate: number;
    pairs: OverlapPair[];
};

/** repair 一对 before/after：源 render（repairOf 指回）vs 修复本。 */
export type RepairPair = {
    genre: string;
    plotId: string;
    repairFile: string;
    renderFile: string;         // = repairOf（源 render 文件名）
    renderModel?: string;       // 源 render 的生成模型
    repairModel?: string;       // 修复模型（repair 样本的 model 字段）
    docScoreBefore: number;     // 源 render docScore（去重 span/千字）
    docScoreAfter: number;      // 修复本 docScore
    externalPAiBefore?: number; // 外部检测器 P(AI)；仅 detector sidecar 覆盖该文本时才有（HF 免费实例可缺省）
    externalPAiAfter?: number;
};

/** repair 报告节（I5：repair 单独统计，绝不进 lift/AUC/docScore 主统计）。全部为逐对配对口径。 */
export type RepairStat = {
    pairs: RepairPair[];
    total: number;                       // 配对成功的对数
    orphans: number;                     // repairOf 缺失 / 找不到源 render 的 repair 样本数
    docScoreMedianBefore: number | null; // 配对集合上的中位；total=0 时 null
    docScoreMedianAfter: number | null;
    docScoreMedianDelta: number | null;  // 逐对 (after−before) 的中位；负 = 修复降低了规则负担
    docScoreImproved: number;            // docScore after < before 的对数
    externalCovered: number;             // 外部检测器同时覆盖 before/after 的对数（0 = 未跑/全缺省）
    externalMedianBefore: number | null; // 以下仅在 covered 子集上统计
    externalMedianAfter: number | null;
    externalMedianDelta: number | null;
    externalImproved: number;            // P(AI) after < before 的对数
};

export type Report = {
    corpusRoot: string;
    generatedNote: string;
    minSupport: number;
    activeRegexRules: number;
    warnings: string[];
    counts: {groups: number; reference: number; render: number; repair: number};
    detector: DetectorStat;
    holdout: HoldoutStat | null; // null=未启用（题组不足或未传 --holdout）
    overlap: OverlapStat;
    modelRanking: ModelRank[];
    rules: RuleStat[];
    externalDetector: ExternalDetectorSummary | null; // null=未跑 detect.ts；对照仪表，不进 lift
    repair: RepairStat | null; // null=语料无 repair 样本；I5 单独统计，不进 lift/AUC
};

/** 外部 AIGC 检测器对照摘要（detect.ts 产出，score.ts 原样搬进 report）。P(AI) 越大越像 AI。 */
export type ExternalDetectorSummary = {
    name: string;
    version: string;
    chunkChars: number;
    referenceMedianPAi: number | null;
    renderMedianPAi: number | null;
    auc: number | null;                                  // P(render P(AI) > reference P(AI))，与 detector.auc 同口径 rocAuc
    coverage: {reference: number; render: number};       // 打分覆盖样本数
    byModel: Array<{model: string; medianPAi: number; n: number}>;
};

/**
 * 数据集正文契约（web 数据集查看器消费；由 evals/dataset.ts 产出）。
 * = Sample 去掉服务端字段（absPath）。含版权正文 → 只本地拖入、不进 git/public。
 */
export type DatasetSample = {
    genre: string;
    plotId: string;
    file: string;
    role: SampleRole;
    model?: string;
    pairRef?: string;       // render 指回本章 reference 文件名（配对键）
    difficulty?: string;
    referenceSource?: string;
    charCount: number;
    text: string;
};

export type Dataset = {
    corpusRoot: string;
    generatedNote: string;
    samples: DatasetSample[];
};

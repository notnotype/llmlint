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
    pairRef?: string; // render 指向的本章 reference 文件名（逐章 1:1 配对键）；reference/repair 无
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

export type Report = {
    corpusRoot: string;
    generatedNote: string;
    minSupport: number;
    activeRegexRules: number;
    warnings: string[];
    counts: {groups: number; reference: number; render: number; repair: number};
    detector: DetectorStat;
    holdout: HoldoutStat | null; // null=未启用（题组不足或未传 --holdout）
    modelRanking: ModelRank[];
    rules: RuleStat[];
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

// 度量：per-rule lift（rate + prevalence 双口径，分层）+ 四桶 + 检测器 ROC-AUC + 模型排名 + holdout。
// reference=人类类，render=AI 类，repair 暂不进判别（M4 单独看）。
import type {DetectorStat, HoldoutStat, ModelRank, RuleStat, SampleScan, StratRate} from "./types";
import type {RuleMeta} from "./scan";

const ALPHA = 0.5;  // rate lift 平滑：rate 单位 /1000 字，0.5 兼顾防除零与抑制小样本爆炸
const BETA = 0.1;   // prevalence lift 平滑：口径是 0..1 的文档占比，用小 β
export const HOLDOUT_MIN_GROUPS = 4; // 少于此题组数 holdout 无统计意义，强制关闭

export type Metrics = {
    counts: {groups: number; reference: number; render: number; repair: number};
    detector: DetectorStat;
    holdout: HoldoutStat | null; // null=未启用
    modelRanking: ModelRank[];
    rules: RuleStat[];
};

/**
 * @param holdoutRatio test 题组占比（0=关闭）。启用后：rule/verdict 只用 train 子集拟合，
 *   holdout 里另报 train/test 两侧 AUC 供泛化校验；题组数 < HOLDOUT_MIN_GROUPS 自动关闭。
 */
export function computeMetrics(scans: SampleScan[], ruleMetas: Map<string, RuleMeta>, minSupport: number, holdoutRatio = 0): Metrics {
    const human = scans.filter((scan) => scan.sample.role === "reference");
    const ai = scans.filter((scan) => scan.sample.role === "render");

    // holdout：确定性切题组。启用后规则统计只在 train 上拟合（verdict 才能拿 test 校验，不循环论证）。
    const split = holdoutRatio > 0 ? splitHoldout(scans, holdoutRatio) : null;
    const ruleScans = split ? split.trainScans : scans;
    const ruleHuman = ruleScans.filter((scan) => scan.sample.role === "reference");
    const ruleAi = ruleScans.filter((scan) => scan.sample.role === "render");

    const rules = ruleStats(ruleHuman, ruleAi, ruleMetas, minSupport).filter((rule) => rule.humanHits + rule.aiHits > 0);
    // 排序按 effectiveLift（= 较强桶），保证「稀疏但 AI-only」的规则也排到前面、不被 TOP_N 截掉。
    rules.sort((left, right) => (right.effectiveLift ?? -1) - (left.effectiveLift ?? -1) || right.aiHits + right.humanHits - (left.aiHits + left.humanHits));

    return {
        counts: countByRole(scans),
        detector: detectorStat(human, ai), // 检测器/排名用全量（headline）
        holdout: split ? holdoutStat(split, holdoutRatio) : null,
        modelRanking: modelRanking(ai),
        rules,
    };
}

/** 单篇某规则的 fireRate（命中/千字）。 */
function fireRate(scan: SampleScan, ruleId: string): number {
    const hits = scan.rawHitsByRule.get(ruleId) ?? 0;
    return scan.sample.charCount > 0 ? (hits / scan.sample.charCount) * 1000 : 0;
}

/** 某规则在一组样本里的 prevalence：命中≥1 次的文档占比（0..1）。 */
function fireFrac(scans: SampleScan[], ruleId: string): number {
    if (scans.length === 0) {
        return 0;
    }
    const fired = scans.filter((scan) => (scan.rawHitsByRule.get(ruleId) ?? 0) > 0).length;
    return fired / scans.length;
}

/** 单篇 docScore：去重 span/千字，作检测器聚合分（文档负担口径，防一句被多规则重复计虚高）。 */
function docScore(scan: SampleScan): number {
    return scan.sample.charCount > 0 ? (scan.dedupSpanCount / scan.sample.charCount) * 1000 : 0;
}

/** 单篇 agent 桶命中率（命中/千字）：review==="agent" 规则的原始命中归一，用于误杀率。 */
function agentFireRate(scan: SampleScan): number {
    return scan.sample.charCount > 0 ? (scan.agentRawHits / scan.sample.charCount) * 1000 : 0;
}

function ruleStats(human: SampleScan[], ai: SampleScan[], ruleMetas: Map<string, RuleMeta>, minSupport: number): RuleStat[] {
    return [...ruleMetas.values()].map((meta) => {
        const humanRate = median(human.map((scan) => fireRate(scan, meta.id)));
        const aiRate = median(ai.map((scan) => fireRate(scan, meta.id)));
        const humanFireFrac = fireFrac(human, meta.id);
        const aiFireFrac = fireFrac(ai, meta.id);
        const humanHits = sumHits(human, meta.id);
        const aiHits = sumHits(ai, meta.id);
        // 两口径 lift：rate（强度）与 prevalence（普遍度）。ai 为空时都为 null。
        const lift = ai.length > 0 ? (aiRate + ALPHA) / (humanRate + ALPHA) : null;
        const prevalenceLift = ai.length > 0 ? (aiFireFrac + BETA) / (humanFireFrac + BETA) : null;
        const effectiveLift = strongerLift(lift, prevalenceLift);

        const pairs = pairCountsByRef(human, ai, meta.id);
        return {
            ...meta,
            humanRate,
            aiRate,
            lift,
            humanFireFrac,
            aiFireFrac,
            prevalenceLift,
            effectiveLift,
            pairsAiGreater: pairs.aiGreater,
            pairsTotal: pairs.total,
            humanHits,
            aiHits,
            verdict: verdictOf(effectiveLift, humanHits + aiHits, minSupport),
            byModel: liftBy(groupByModel(ai), human, meta.id),
            byGenre: liftBy(groupByGenre(ai), human, meta.id, groupByGenre(human)),
        };
    });
}

/** 取「较强」的 lift（更偏向判别 AI 的一侧）。两者皆 null（无 AI）时返回 null。 */
function strongerLift(rateLift: number | null, prevalenceLift: number | null): number | null {
    if (rateLift === null && prevalenceLift === null) {
        return null;
    }
    return Math.max(rateLift ?? Number.NEGATIVE_INFINITY, prevalenceLift ?? Number.NEGATIVE_INFINITY);
}

function verdictOf(lift: number | null, support: number, minSupport: number): RuleStat["verdict"] {
    if (lift === null || support < minSupport) {
        return "insufficient";
    }
    if (lift >= 3) {
        return "strong";
    }
    if (lift >= 1.5) {
        return "weak";
    }
    if (lift >= 0.67) {
        return "noise";
    }
    return "anti";
}

/**
 * 按分层桶（模型或题材）算各桶 lift。
 * @param aiGroups   AI 侧分桶
 * @param allHuman   人类侧全量（无 humanGroups 时各桶共用其中位率，如 byModel）
 * @param humanGroups 人类侧分桶（提供时各桶用同桶人类率，如 byGenre）
 */
function liftBy(aiGroups: Map<string, SampleScan[]>, allHuman: SampleScan[], ruleId: string, humanGroups?: Map<string, SampleScan[]>): Record<string, StratRate> {
    const out: Record<string, StratRate> = {};
    const sharedHumanRate = humanGroups ? 0 : median(allHuman.map((scan) => fireRate(scan, ruleId)));
    for (const [key, aiScans] of aiGroups) {
        const humanRate = humanGroups ? median((humanGroups.get(key) ?? []).map((scan) => fireRate(scan, ruleId))) : sharedHumanRate;
        const aiRate = median(aiScans.map((scan) => fireRate(scan, ruleId)));
        out[key] = {humanRate, aiRate, lift: (aiRate + ALPHA) / (humanRate + ALPHA)};
    }
    return out;
}

/**
 * 逐章 1:1 配对：render 的 pairRef 指回本章 reference 文件名，按 (题组/pairRef) 聚合，
 * 与 file 匹配的 reference 比较该规则率。缺 pairRef 的 render 不计入（回退题组级已弃）。
 */
function pairCountsByRef(human: SampleScan[], ai: SampleScan[], ruleId: string): {aiGreater: number; total: number} {
    const humanByFile = new Map<string, SampleScan>();
    for (const scan of human) {
        humanByFile.set(`${plotKey(scan)}/${scan.sample.file}`, scan);
    }
    const aiByRef = new Map<string, SampleScan[]>();
    for (const scan of ai) {
        if (!scan.sample.pairRef) {
            continue;
        }
        const key = `${plotKey(scan)}/${scan.sample.pairRef}`;
        const bucket = aiByRef.get(key) ?? [];
        bucket.push(scan);
        aiByRef.set(key, bucket);
    }

    let aiGreater = 0;
    let total = 0;
    for (const [key, aiScans] of aiByRef) {
        const humanScan = humanByFile.get(key);
        if (!humanScan) {
            continue;
        }
        total += 1;
        if (mean(aiScans.map((scan) => fireRate(scan, ruleId))) > fireRate(humanScan, ruleId)) {
            aiGreater += 1;
        }
    }
    return {aiGreater, total};
}

function detectorStat(human: SampleScan[], ai: SampleScan[]): DetectorStat {
    const humanScores = human.map(docScore);
    const aiScores = ai.map(docScore);
    return {
        auc: rocAuc(aiScores, humanScores),
        humanMedianScore: median(humanScores),
        aiMedianScore: median(aiScores),
        humanAgentFalseRate: median(human.map(agentFireRate)),
        aiAgentRate: median(ai.map(agentFireRate)),
        humanCount: human.length,
        aiCount: ai.length,
    };
}

type HoldoutSplit = {trainScans: SampleScan[]; testScans: SampleScan[]; trainGroups: string[]; testGroups: string[]};

/** 至少存在一条 render.pairRef 指向同题组 reference.file 的题组，才有资格进入 holdout。 */
export function countPairedGroups(scans: SampleScan[]): number {
    return pairedGroupKeys(scans).size;
}

/** 确定性切配对题组：按 genre/plotId 排序，末尾 round(ratio·N) 组作 test，其余 train。 */
function splitHoldout(scans: SampleScan[], ratio: number): HoldoutSplit | null {
    const pairedKeys = pairedGroupKeys(scans);
    const keys = [...pairedKeys].sort((left, right) => left.localeCompare(right));
    if (keys.length < HOLDOUT_MIN_GROUPS) {
        return null;
    }
    const testCount = Math.min(keys.length - 1, Math.max(1, Math.round(ratio * keys.length)));
    const testGroups = keys.slice(keys.length - testCount);
    const testSet = new Set(testGroups);
    return {
        trainScans: scans.filter((scan) => pairedKeys.has(plotKey(scan)) && !testSet.has(plotKey(scan))),
        testScans: scans.filter((scan) => testSet.has(plotKey(scan))),
        trainGroups: keys.slice(0, keys.length - testCount),
        testGroups,
    };
}

/** 收集至少有一组有效 reference/render 映射的题组 key。 */
function pairedGroupKeys(scans: SampleScan[]): Set<string> {
    const references = new Map<string, Set<string>>();
    for (const scan of scans) {
        if (scan.sample.role !== "reference") {
            continue;
        }
        const key = plotKey(scan);
        const files = references.get(key) ?? new Set<string>();
        files.add(scan.sample.file);
        references.set(key, files);
    }
    const paired = new Set<string>();
    for (const scan of scans) {
        if (scan.sample.role !== "render" || !scan.sample.pairRef) {
            continue;
        }
        const key = plotKey(scan);
        if (references.get(key)?.has(scan.sample.pairRef)) {
            paired.add(key);
        }
    }
    return paired;
}

function holdoutStat(split: HoldoutSplit, ratio: number): HoldoutStat {
    const auc = (subset: SampleScan[]): number | null => rocAuc(
        subset.filter((scan) => scan.sample.role === "render").map(docScore),
        subset.filter((scan) => scan.sample.role === "reference").map(docScore),
    );
    return {
        ratio,
        trainGroups: split.trainGroups.length,
        testGroups: split.testGroups.length,
        trainAuc: auc(split.trainScans),
        testAuc: auc(split.testScans),
    };
}

function modelRanking(ai: SampleScan[]): ModelRank[] {
    const ranks: ModelRank[] = [];
    for (const [model, scans] of groupByModel(ai)) {
        ranks.push({model, medianScore: median(scans.map(docScore)), sampleCount: scans.length});
    }
    return ranks.sort((left, right) => left.medianScore - right.medianScore);
}

/** ROC-AUC = P(score_AI > score_human)，平均秩处理并列。空类返回 null。 */
function rocAuc(positive: number[], negative: number[]): number | null {
    if (positive.length === 0 || negative.length === 0) {
        return null;
    }
    const all = [
        ...positive.map((score) => ({score, positive: true})),
        ...negative.map((score) => ({score, positive: false})),
    ].sort((left, right) => left.score - right.score);

    let rankSumPositive = 0;
    let i = 0;
    while (i < all.length) {
        let j = i;
        while (j < all.length && all[j]!.score === all[i]!.score) {
            j += 1;
        }
        const averageRank = (i + 1 + j) / 2; // 秩 i+1..j 的平均
        for (let k = i; k < j; k += 1) {
            if (all[k]!.positive) {
                rankSumPositive += averageRank;
            }
        }
        i = j;
    }
    const nPositive = positive.length;
    return (rankSumPositive - (nPositive * (nPositive + 1)) / 2) / (nPositive * negative.length);
}

function plotKey(scan: SampleScan): string {
    return `${scan.sample.genre}/${scan.sample.plotId}`;
}

function groupByModel(scans: SampleScan[]): Map<string, SampleScan[]> {
    return groupBy(scans, (scan) => scan.sample.model ?? "unknown");
}

function groupByGenre(scans: SampleScan[]): Map<string, SampleScan[]> {
    return groupBy(scans, (scan) => scan.sample.genre);
}

function groupBy(scans: SampleScan[], key: (scan: SampleScan) => string): Map<string, SampleScan[]> {
    const map = new Map<string, SampleScan[]>();
    for (const scan of scans) {
        const bucket = map.get(key(scan)) ?? [];
        bucket.push(scan);
        map.set(key(scan), bucket);
    }
    return map;
}

function countByRole(scans: SampleScan[]): Metrics["counts"] {
    const groups = new Set(scans.map(plotKey));
    return {
        groups: groups.size,
        reference: scans.filter((scan) => scan.sample.role === "reference").length,
        render: scans.filter((scan) => scan.sample.role === "render").length,
        repair: scans.filter((scan) => scan.sample.role === "repair").length,
    };
}

function sumHits(scans: SampleScan[], ruleId: string): number {
    return scans.reduce((total, scan) => total + (scan.rawHitsByRule.get(ruleId) ?? 0), 0);
}

function median(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function mean(values: number[]): number {
    return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

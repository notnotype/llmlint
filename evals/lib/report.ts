// 报告数据模型组装：Metrics → Report（唯一产物，写成 report.json）。
// 表现层（表格/图/排序筛选）由 web/ 的 Vue 页消费 report.json 渲染，不在评测侧做。
import type {Metrics} from "./metrics";
import type {Report} from "./types";

export function buildReport(corpusRoot: string, metrics: Metrics, activeRegexRules: number, minSupport: number, warnings: string[]): Report {
    const hasAi = metrics.counts.render > 0;
    return {
        corpusRoot,
        generatedNote: hasAi
            ? "lift = AI率/人类率（rate 口径，原始命中/千字，α 平滑）；prevLift = 命中文档占比之比（β 平滑）；裁决取两者较强桶；docScore = 去重 span/千字。"
            : "M1：仅人类 reference、无 AI render，lift/AUC 待 render；本表为人类侧命中率（= 误杀基线）。",
        minSupport,
        activeRegexRules,
        warnings,
        counts: metrics.counts,
        detector: metrics.detector,
        holdout: metrics.holdout,
        modelRanking: metrics.modelRanking,
        rules: metrics.rules,
    };
}

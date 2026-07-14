// 引擎适配：直接复用 llmlint 规则引擎（不 spawn CLI）。loadRules 用 import.meta.url 定位
// rulesets，cwd 无关；scanText 全文扫描（小说散文不需要 markdown 遮罩）。
import {loadRules} from "../../skill/src/rules";
import {scanText} from "../../skill/src/scanner";
import type {Issue, NormalizedLlmlintConfig, RegexRuleRecord} from "../../skill/src/types";
import {computeOverlapStat, type OverlapHit} from "./overlap";
import type {OverlapStat, Sample, SampleScan} from "./types";

// 评测固定用默认 ruleset 全量，不读项目 llmlint.config.ts（避免环境差异）。
const DEFAULT_EVAL_CONFIG: NormalizedLlmlintConfig = {
    rulesets: ["builtin/default"],
    trustedRulesets: [],
    rulesetOverrides: {},
    namespaces: {},
    rules: {},
    output: "json",
};

export type RuleMeta = {id: string; namespace: string; review: string; level: string};

export type ScanAllResult = {
    scans: SampleScan[];
    ruleMetas: Map<string, RuleMeta>;
    activeRegexRules: number;
    overlap: OverlapStat;
};

/** 评测口径的规则加载（builtin/default 全量，不读项目 llmlint.config.ts）。scanAll 与 repair 管线共用，保证同口径。 */
export async function loadEvalRules(): Promise<{regexRules: RegexRuleRecord[]; ruleMetas: Map<string, RuleMeta>}> {
    const loaded = await loadRules(DEFAULT_EVAL_CONFIG);
    const ruleMetas = new Map<string, RuleMeta>();
    for (const rule of loaded.regexRules) {
        ruleMetas.set(rule.id, {id: rule.id, namespace: rule.namespace, review: rule.review, level: rule.level});
    }
    return {regexRules: loaded.regexRules, ruleMetas};
}

/** 加载规则一次，扫描全部样本。 */
export async function scanAll(samples: Sample[]): Promise<ScanAllResult> {
    const {regexRules, ruleMetas} = await loadEvalRules();
    const scans: SampleScan[] = [];
    const overlapDocuments: OverlapHit[][] = [];
    for (const sample of samples) {
        const result = scanSample(sample, regexRules, ruleMetas);
        scans.push(result.scan);
        if (sample.role === "reference" || sample.role === "render") {
            overlapDocuments.push(result.overlapHits);
        }
    }
    return {
        scans,
        ruleMetas,
        activeRegexRules: regexRules.length,
        overlap: computeOverlapStat(overlapDocuments),
    };
}

function scanSample(sample: Sample, regexRules: RegexRuleRecord[], ruleMetas: Map<string, RuleMeta>): {scan: SampleScan; overlapHits: OverlapHit[]} {
    const issues = scanText(sample.text, regexRules, {});
    const rawHitsByRule = new Map<string, number>();
    let agentRawHits = 0;
    for (const issue of issues) {
        rawHitsByRule.set(issue.rule.id, (rawHitsByRule.get(issue.rule.id) ?? 0) + 1);
        if ((ruleMetas.get(issue.rule.id)?.review ?? issue.rule.review) === "agent") {
            agentRawHits += 1;
        }
    }
    return {
        scan: {
            sample,
            rawHitsByRule,
            dedupSpanCount: countDedupSpans(sample.text, issues),
            agentRawHits,
        },
        overlapHits: issues.map((issue) => ({
            ruleId: issue.rule.id,
            spanKey: `${issue.line}:${issue.column}:${issue.endLine}:${issue.endColumn}:${issue.match}`,
        })),
    };
}

/** 文档负担口径：把命中的 [start,end) 码点区间合并，重叠算一处（防一句话被多条规则重复计）。 */
function countDedupSpans(text: string, issues: Issue[]): number {
    if (issues.length === 0) {
        return 0;
    }
    const lineStarts = codepointLineStarts(text);
    const intervals = issues
        .map((issue) => {
            const start = (lineStarts[issue.line - 1] ?? 0) + (issue.column - 1);
            const end = (lineStarts[issue.endLine - 1] ?? 0) + issue.endColumn;
            return [start, Math.max(end, start + 1)] as [number, number];
        })
        .sort((left, right) => left[0] - right[0]);

    let merged = 1;
    let currentEnd = intervals[0]![1];
    for (let i = 1; i < intervals.length; i += 1) {
        const [start, end] = intervals[i]!;
        if (start >= currentEnd) {
            merged += 1;
            currentEnd = end;
        } else if (end > currentEnd) {
            currentEnd = end;
        }
    }
    return merged;
}

/** 每行起点的码点偏移；lineStarts[i] = 第 i+1 行起点的码点下标。 */
function codepointLineStarts(text: string): number[] {
    const starts = [0];
    let codepoint = 0;
    for (const char of text) {
        codepoint += 1;
        if (char === "\n") {
            starts.push(codepoint);
        }
    }
    return starts;
}

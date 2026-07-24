// 预烘脚本：在 Node/Bun 侧跑一次 loadRules（读文件系统里 ~340 条规则 JSON），
// 把浏览器需要的静态数据序列化成 app/data/registry.json。
// 浏览器不读文件系统、不跑 loadRules，只 import 这份产物 + 调纯函数 scanText。
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {materializeRules} from "../../skill/src/rule-registry";
import {loadRuleCatalog} from "../../skill/src/rules";
import {LLMLINT_VERSION} from "../../skill/src/version";
import type {NormalizedLlmlintConfig} from "../../skill/src/types";
import type {RuleStat} from "../../evals/lib/types";
import {buildCreativeProfile} from "../shared/rule-profile";

// 与 skill/src/config.ts 的 DEFAULT_CONFIG 一致：无配置时的默认 ruleset。
const DEFAULT_CONFIG: NormalizedLlmlintConfig = {
    rulesets: ["builtin/default"],
    trustedRulesets: [],
    rulesetOverrides: {},
    namespaces: {},
    rules: {},
    ignoreTerms: [],
    output: "json",
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../app/data/registry.json");

const source = await loadRuleCatalog(DEFAULT_CONFIG);
const loaded = materializeRules({
    catalog: source.catalog,
    config: DEFAULT_CONFIG,
    diagnostics: source.diagnostics,
    namespaceAliases: source.namespaceAliases,
    loadedRulesets: source.loadedRulesets,
});

// engineVersion 单源（Task 13 D-C）：包版本 + 默认配置下静态扫描规则集的内容 hash。
// 规则文件改动但包版本未升时，hash 变化仍能把 MachineScan 按真实引擎行为分版（@@unique(revisionId, engineVersion) 允许 re-scan）。
// 只 hash 静态扫描相关规则：verdict 烘焙不改变扫描行为，不入 hash。
const staticRules = {
    regexRules: loaded.regexRules,
    densityRules: loaded.densityRules,
    handlerRules: loaded.handlerRules,
};
const rulesHash = createHash("sha256").update(JSON.stringify(staticRules)).digest("hex").slice(0, 8);
const engineVersion = `${LLMLINT_VERSION}+r${rulesHash}`;

// 判别裁决烘焙：读 evals 跑分产物 report.json（若存在），把 per-rule verdict/effectiveLift
// 烘进 registry，供规则排序、展示与创作修复 task profile 使用。report 可缺失，缺失时保留全量候选。
const reportPath = resolve(here, "../../evals/report/report.json");
let ruleVerdicts: Record<string, {verdict: RuleStat["verdict"]; effectiveLift: number | null}> | undefined;
// 规则报告烘焙（Task 15 P0-B）：把 report.json 的 per-rule 全量统计烘成 app/data/rules-report.json，
// 供 /rules 规则页展示（verdict/effectiveLift/两侧命中与样本数……）。与 ruleVerdicts 同一次读取；
// report 缺失时**仍写文件**（空 rules 降级产物）——规则页 import 不能因缺产物而构建失败。
let reportRules: RuleStat[] = [];
let reportMeta: {minSupport: number; counts: {reference: number; render: number}} | null = null;
if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, "utf-8")) as {
        rules?: RuleStat[];
        minSupport?: number;
        counts?: {reference?: number; render?: number};
    };
    if (Array.isArray(report.rules)) {
        reportRules = report.rules;
        reportMeta = {
            minSupport: report.minSupport ?? 0,
            counts: {reference: report.counts?.reference ?? 0, render: report.counts?.render ?? 0},
        };
        ruleVerdicts = {};
        for (const stat of report.rules) {
            ruleVerdicts[stat.id] = {verdict: stat.verdict, effectiveLift: stat.effectiveLift};
        }
    } else {
        console.warn("evals/report/report.json 缺 rules 数组，跳过 verdict 烘焙（消费端降级为仅 fixability 过滤）。");
    }
} else {
    console.warn(`未找到 ${reportPath}，跳过 verdict 烘焙（消费端降级为仅 fixability 过滤）。`);
}

const creativeProfile = buildCreativeProfile(
    loaded.regexRules.map((rule) => rule.id),
    ruleVerdicts,
);

// 只序列化浏览器需要的：扫描用的 regex/density/handler 规则（含全部元数据）、只读展示用的 llmRules、
// 统计 summary、加载 diagnostics。version 供页脚展示；engineVersion 供服务端 MachineScan 落库（单源）；
// ruleVerdicts 供规则排序、展示与创作修复 profile 使用（report 缺失则整个字段缺省）。
const registry = {
    version: LLMLINT_VERSION,
    engineVersion,
    generatedFrom: "builtin/default",
    catalog: source.catalog,
    namespaceAliases: source.namespaceAliases,
    loadedRulesets: source.loadedRulesets,
    summary: loaded.summary,
    diagnostics: loaded.diagnostics,
    regexRules: loaded.regexRules,
    densityRules: loaded.densityRules,
    handlerRules: loaded.handlerRules,
    llmRules: loaded.llmRules,
    creativeProfile,
    ...(ruleVerdicts === undefined ? {} : {ruleVerdicts}),
};

mkdirSync(dirname(outPath), {recursive: true});
writeFileSync(outPath, JSON.stringify(registry), "utf-8");

const strongCount = ruleVerdicts === undefined
    ? null
    : Object.values(ruleVerdicts).filter((entry) => entry.verdict === "strong").length;
console.log(
    `registry.json 已生成：${loaded.regexRules.length} 条 regex 规则、` +
        `${loaded.densityRules.length} 条 density 规则、${loaded.handlerRules.length} 条 handler 规则、` +
        `${loaded.llmRules.length} 条 llm 规则、${loaded.summary.activeRules}/${loaded.summary.totalRules} active，engine ${engineVersion}，` +
        (strongCount === null
            ? "verdict 未烘焙（降级口径）。"
            : `verdict 已烘焙 ${Object.keys(ruleVerdicts ?? {}).length} 条（strong ${strongCount}）`)
        + `；profile ${creativeProfile.id}@${creativeProfile.version} 纳入 ${creativeProfile.includedRuleIds.length} 条。`,
);

// ─────────────── 规则报告烘焙产物（Task 15 P0-B，/rules 规则页消费） ───────────────
// per-rule 条目 = RuleStat 全量统计换名（id → ruleId），按 effectiveLift 降序预排（null 殿后，
// 同值按 ruleId 字典序稳定）——规则页默认展示顺序即判别力排序，前端也可按任意数值列重排。
// 规则本体（正则/说明/示例）不在此文件：从 registry.json 按 ruleId join。
type RulesReportEntry = {ruleId: string} & Omit<RuleStat, "id">;
const rulesReportEntries: RulesReportEntry[] = reportRules
    .map(({id, ...stat}) => ({ruleId: id, ...stat}))
    .sort((left, right) => {
        const leftLift = left.effectiveLift ?? Number.NEGATIVE_INFINITY;
        const rightLift = right.effectiveLift ?? Number.NEGATIVE_INFINITY;
        if (leftLift !== rightLift) {
            return rightLift - leftLift;
        }
        return left.ruleId.localeCompare(right.ruleId);
    });
const rulesReport = {
    generatedAt: new Date().toISOString(),
    // 与 registry.json 同一次构建的引擎版本戳：规则页与扫描行为按它对表。
    engineVersion,
    // null = report.json 缺失/无 rules（降级：rules 为空数组，规则页注明"未跑评测"）。
    source: reportMeta === null ? null : "evals/report/report.json",
    // 判别统计的准入门槛（两侧命中都低于它的规则 verdict=insufficient）；降级时 null。
    minSupport: reportMeta?.minSupport ?? null,
    // 两侧样本数：human=reference 篇数、ai=render 篇数（per-rule humanHits/aiHits 的全集规模）；降级时 null。
    sampleCounts: reportMeta === null ? null : {human: reportMeta.counts.reference, ai: reportMeta.counts.render},
    rules: rulesReportEntries,
};
const rulesReportPath = resolve(here, "../app/data/rules-report.json");
writeFileSync(rulesReportPath, JSON.stringify(rulesReport), "utf-8");
console.log(
    reportMeta === null
        ? "rules-report.json 已生成（降级：report.json 缺失，rules 为空）。"
        : `rules-report.json 已生成：${rulesReportEntries.length} 条规则统计（样本 human ${rulesReport.sampleCounts?.human} / ai ${rulesReport.sampleCounts?.ai}）。`,
);

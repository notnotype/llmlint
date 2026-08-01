#!/usr/bin/env bun
// 写作期约束元评测 · 分析侧：配对比较 control 与 guide 两臂。
//
// **为什么不能只看 docScore**：把 llmlint 的规则塞进提示词、再用 llmlint 数命中降了多少，
// 是近乎同义反复的循环论证（D5 防的就是 Goodhart 到单一指标）。所以指标分三层：
//
// - 主指标 = 外部 AIGC 检测器 docPAi，与规则库完全独立。
// - 主要佐证 = **留出规则**命中率：注入某档后，档外规则也该跟着降；只有注入的那批降，
//   说明模型只是躲开了被告知的词，散文本身没变好。
// - sanity = 注入规则命中率与整体 docScore，循环，只用来确认注入确实生效，不作结论。
//
// D5 的第二条件（人评 wantReadOn 不降）当前拿不到——第 ② 层 critic 未建，所以本脚本
// 的结论只能是暂定的，报告里明说。
import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {loadCorpus, visibleLength} from "../lib/corpus";
import {scanAll} from "../lib/scan";
import {detectorCacheKey, type DetectorScoresFile} from "../detector/scores";
import {loadRules} from "../../skill/src/rules";
import {buildGuideArtifact, selectGuideRules, GUIDE_TIERS, parseRuleVerdicts, type GuideTier, type RuleVerdicts} from "../../skill/src/guide";
import type {Sample, SampleScan} from "../lib/types";
import {verifyExperimentGuide} from "./arm-corpus";

const DEFAULT_ARM_CORPUS = join(import.meta.dir, "guide-arm-v3");
const DEFAULT_MAIN_CORPUS = join(import.meta.dir, "..", "corpus");

/**
 * 一对配对样本：同 brief、同模型，只差一个受控变量（有没有注入约束、或约束从哪里投递）。
 *
 * 用 baseline / treatment 而不是写死 control / guide，是为了让同一套统计口径能比较任意两臂
 * ——delivery 实验有三臂（control / sysprompt / toolresult），需要跑三次两两比较。
 */
type Pair = {
    genre: string;
    plotId: string;
    pairRef: string;
    model: string;
    baseline: SampleScan;
    treatment: SampleScan;
};

/** 一个臂在一对里的三个率（都按每千可见字归一，便于跨篇幅比较）。 */
type ArmRates = {
    /** 注入档内规则的原始命中 / 千字。循环指标，只作 sanity。 */
    injected: number;
    /** 档外规则的原始命中 / 千字。主要佐证。 */
    heldOut: number;
    /** 去重 span / 千字（I4 的文档负担口径）。整体，含注入部分，同样循环。 */
    docScore: number;
    /** 外部检测器 docPAi；无检测结果时 null。 */
    pAi: number | null;
    chars: number;
};

async function run(opts: {arm: string; main: string; tier: string; profile?: string; detector?: string; arms: string; model?: string}): Promise<void> {
    const tier = resolveTier(opts.tier);
    const arms = resolveArms(opts.arms);
    const armRoot = resolve(opts.arm);

    // 扫描样本之前先重建 guide 并严格核对 meta，防止档位/profile/规则/文本漂移静默改写注入集合。
    const loaded = await loadRules({rulesets: ["builtin/default"], trustedRulesets: [], rulesetOverrides: {}, namespaces: {}, rules: {}, ignoreTerms: [], output: "json"});
    let verdicts: RuleVerdicts = new Map();
    if (opts.profile !== undefined) {
        verdicts = parseRuleVerdicts(readFileSync(resolve(opts.profile), "utf-8"));
    }
    const guide = buildGuideArtifact(loaded, tier, verdicts, opts.profile !== undefined);
    verifyExperimentGuide(armRoot, guide.provenance);

    const {samples, warnings} = loadCorpus(armRoot);
    for (const warning of warnings) {
        console.log(`⚠ ${warning}`);
    }
    const renders = samples.filter((sample) => sample.role === "render");
    if (renders.length === 0) {
        throw new Error(`实验语料里没有 render 样本：${armRoot}（先跑 guide-arm.ts 生成）`);
    }

    // 注入集合继续复用 guide 档位选择逻辑；provenance 已证明它与生成时一致。
    const injectedIds = new Set(selectGuideRules(loaded.rules, tier, verdicts).map((rule) => rule.id));
    console.log(`注入档位 ${tier}：${injectedIds.size} 条规则进提示词，${loaded.rules.length - injectedIds.size} 条留出\n`);

    const {scans} = await scanAll(renders);
    const pAiByText = loadDetectorScores(opts.detector);
    let pairs = buildPairs(scans, arms);
    if (opts.model !== undefined) {
        // 子串匹配：语料里的 model 是「provider/模型名」全称（如 xiaomi-token-plan-cn/mimo-v2.5-pro），
        // 命令行只写 deepseek / gemini / mimo 这类短键即可。
        const key = opts.model;
        const before = pairs.length;
        pairs = pairs.filter((pair) => pair.model.includes(key));
        console.log(`按模型过滤「${key}」：${before} 组配对中保留 ${pairs.length} 组\n`);
    }
    if (pairs.length === 0) {
        throw new Error(`没有配对上任何样本：${arms[0]} 与 ${arms[1]} 两臂都要有同 brief、同模型的产出${opts.model === undefined ? "" : `，且模型名包含「${opts.model}」`}。`);
    }

    const rows = pairs.map((pair) => ({
        pair,
        baseline: ratesOf(pair.baseline, injectedIds, pAiByText),
        treatment: ratesOf(pair.treatment, injectedIds, pAiByText),
    }));

    console.log(`比较 ${arms[0]}（基线） → ${arms[1]}（处理）`);
    console.log(`配对 ${pairs.length} 组（题组 ${new Set(pairs.map((pair) => `${pair.genre}/${pair.plotId}`)).size}，模型 ${new Set(pairs.map((pair) => pair.model)).size}）\n`);

    report("外部检测器 docPAi（主指标，与规则库独立）", rows.map((row) => [row.baseline.pAi, row.treatment.pAi] as const), arms);
    report("留出规则命中 / 千字（主要佐证：档外规则也该降）", rows.map((row) => [row.baseline.heldOut, row.treatment.heldOut] as const), arms);
    report("注入规则命中 / 千字（sanity，循环）", rows.map((row) => [row.baseline.injected, row.treatment.injected] as const), arms);
    report("docScore 去重 span / 千字（整体，循环）", rows.map((row) => [row.baseline.docScore, row.treatment.docScore] as const), arms);
    report("可见字数（确认约束没有压垮篇幅）", rows.map((row) => [row.baseline.chars, row.treatment.chars] as const), arms);

    // 人类参照：guide 臂有没有朝人类分布移动，比「降了多少」更有意义。
    const human = await humanBaseline(resolve(opts.main), pairs, injectedIds);
    if (human !== null) {
        console.log(`人类参照（同题组 reference，${human.count} 篇）：留出规则 ${human.heldOut.toFixed(2)} / 千字，docScore ${human.docScore.toFixed(2)} / 千字\n`);
    }

    console.log(`判读口径：`);
    console.log(`  · 主指标降 + 留出规则降 → 有证据支持注入写作约束。`);
    console.log(`  · 只有注入规则降、留出规则不降 → 表层规避，散文没变好，不要采纳。`);
    console.log(`  · 主指标不降 → 无论 docScore 降多少都不构成证据（循环）。`);
    console.log(`  · D5 第二条件（人评 wantReadOn 不降）当前无法测量，任何结论都是暂定的。`);
}

/** 单臂三率。命中按每千可见字归一；注入/留出用原始命中（I4：per-rule 口径用 rawHits）。 */
function ratesOf(scan: SampleScan, injectedIds: Set<string>, pAiOf: (text: string) => number | null): ArmRates {
    const chars = scan.sample.charCount;
    const perKilo = (count: number) => (chars === 0 ? 0 : (count / chars) * 1000);
    let injected = 0;
    let heldOut = 0;
    for (const [ruleId, hits] of scan.rawHitsByRule) {
        if (injectedIds.has(ruleId)) {
            injected += hits;
        } else {
            heldOut += hits;
        }
    }
    return {
        injected: perKilo(injected),
        heldOut: perKilo(heldOut),
        docScore: perKilo(scan.dedupSpanCount),
        pAi: pAiOf(scan.sample.text),
        chars,
    };
}

/**
 * 按 (题组, pairRef, 模型) 配对指定的两臂；缺一臂的样本直接丢弃，不做单臂统计。
 *
 * @param arms [基线臂 styleKey, 处理臂 styleKey]。语料里其它臂的样本被忽略——三臂语料跑
 *   两两比较时，每次只取需要的那两个。
 */
function buildPairs(scans: SampleScan[], arms: readonly [string, string]): Pair[] {
    const [baselineArm, treatmentArm] = arms;
    const byKey = new Map<string, {baseline?: SampleScan; treatment?: SampleScan; sample: Sample}>();
    for (const scan of scans) {
        const {genre, plotId, pairRef, styleKey} = scan.sample;
        if (!pairRef || (styleKey !== baselineArm && styleKey !== treatmentArm)) {
            continue;
        }
        const key = `${genre}/${plotId}/${pairRef}/${scan.sample.model ?? ""}`;
        const entry = byKey.get(key) ?? {sample: scan.sample};
        entry[styleKey === baselineArm ? "baseline" : "treatment"] = scan;
        byKey.set(key, entry);
    }
    const pairs: Pair[] = [];
    for (const [key, entry] of byKey) {
        if (!entry.baseline || !entry.treatment) {
            console.log(`⚠ 跳过未配对：${key}（缺 ${entry.baseline ? treatmentArm : baselineArm} 臂）`);
            continue;
        }
        const [genre, plotId, pairRef] = key.split("/");
        pairs.push({genre: genre!, plotId: plotId!, pairRef: pairRef!, model: entry.sample.model ?? "", baseline: entry.baseline, treatment: entry.treatment});
    }
    return pairs.sort((left, right) => `${left.genre}${left.plotId}${left.pairRef}${left.model}`.localeCompare(`${right.genre}${right.plotId}${right.pairRef}${right.model}`));
}

/**
 * 输出一项指标的配对比较。
 *
 * 用「逐对差值的中位数」而不是「两组中位数之差」——配对设计的信息在差值里，
 * 后者会把配对结构丢掉。同时给胜率与符号检验 p 值，避免在十几对样本上过度解读方向。
 */
function report(label: string, values: Array<readonly [number | null, number | null]>, arms: readonly [string, string]): void {
    const usable = values.filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null);
    if (usable.length === 0) {
        console.log(`${label}\n  无数据（该指标缺测量结果）\n`);
        return;
    }
    const deltas = usable.map(([baseline, treatment]) => treatment - baseline);
    const wins = deltas.filter((delta) => delta < 0).length;
    const ties = deltas.filter((delta) => delta === 0).length;
    const decided = usable.length - ties;
    console.log(`${label}`);
    console.log(`  ${arms[0]} 中位 ${median(usable.map((pair) => pair[0])).toFixed(3)}｜${arms[1]} 中位 ${median(usable.map((pair) => pair[1])).toFixed(3)}`);
    console.log(`  逐对差值中位 ${median(deltas).toFixed(3)}（负 = ${arms[1]} 更低）｜${arms[1]} 更低 ${wins}/${decided}${ties > 0 ? `（另有 ${ties} 对持平）` : ""}`);
    console.log(`  符号检验 p = ${decided === 0 ? "—" : signTestP(wins, decided).toFixed(3)}${decided > 0 && signTestP(wins, decided) > 0.05 ? "（不显著，不要据此下结论）" : ""}\n`);
}

/** 双侧符号检验精确 p 值：n 对里有 k 对朝同一方向，原假设 = 各 50%。 */
function signTestP(wins: number, n: number): number {
    const extreme = Math.max(wins, n - wins);
    let tail = 0;
    for (let k = extreme; k <= n; k++) {
        tail += binomial(n, k);
    }
    return Math.min(1, (2 * tail) / 2 ** n);
}

function binomial(n: number, k: number): number {
    let result = 1;
    for (let i = 0; i < k; i++) {
        result = (result * (n - i)) / (i + 1);
    }
    return result;
}

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
}

/** 同题组人类 reference 的命中率，作为「朝人类分布移动了多少」的参照系。 */
async function humanBaseline(mainCorpus: string, pairs: Pair[], injectedIds: Set<string>): Promise<{count: number; heldOut: number; docScore: number} | null> {
    if (!existsSync(mainCorpus)) {
        return null;
    }
    const groups = new Set(pairs.map((pair) => `${pair.genre}/${pair.plotId}`));
    const refs = loadCorpus(mainCorpus).samples.filter((sample) => sample.role === "reference" && groups.has(`${sample.genre}/${sample.plotId}`));
    if (refs.length === 0) {
        return null;
    }
    const {scans} = await scanAll(refs);
    // 人类参照只用规则侧指标，不查检测器（reference 的检测分在主报告里另有口径）。
    const rates = scans.map((scan) => ratesOf(scan, injectedIds, () => null));
    return {count: rates.length, heldOut: median(rates.map((rate) => rate.heldOut)), docScore: median(rates.map((rate) => rate.docScore))};
}

/**
 * 读外部检测器结果，返回「按正文查 docPAi」的函数。
 *
 * 缓存键是内容哈希（detector|version|chunkChars|正文），所以只要正文一致就能命中，
 * 与文件名、目录无关；正文一改即查不到 = 视为未打分，不会拿到陈旧分数。
 * 口径三元组从文件自身读，不在这里手写常量。
 */
function loadDetectorScores(path: string | undefined): (text: string) => number | null {
    if (path === undefined) {
        return () => null;
    }
    const resolved = resolve(path);
    if (!existsSync(resolved)) {
        throw new Error(`检测器结果不存在：${path}（先跑 evals/detector/detect.ts --corpus <实验语料> --out <目录>）`);
    }
    const file = JSON.parse(readFileSync(resolved, "utf-8")) as DetectorScoresFile;
    // meanPAi = 文档级长度加权均值，与 skill 侧 detect 的 docPAi 同口径。
    return (text: string) => file.entries[detectorCacheKey(file.detector, file.version, file.chunkChars, text)]?.doc.meanPAi ?? null;
}

/**
 * 解析 `--arms baseline,treatment`。
 *
 * 不校验臂名是否存在于语料里——那由 buildPairs 的「未配对」告警负责，写错名字会得到
 * 0 组配对并直接报错，比在这里维护一份合法臂名清单更不容易漂移。
 */
function resolveArms(raw: string): [string, string] {
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) {
        throw new Error(`--arms 需要两个用逗号分隔的臂名（基线,处理），收到：${raw}`);
    }
    if (parts[0] === parts[1]) {
        throw new Error(`--arms 的两个臂名不能相同：${raw}`);
    }
    return [parts[0]!, parts[1]!];
}

function resolveTier(tier: string): GuideTier {
    if (!GUIDE_TIERS.includes(tier as GuideTier)) {
        throw new Error(`档位无效：${tier}。合法值：${GUIDE_TIERS.join("、")}`);
    }
    return tier as GuideTier;
}

const program = new Command();
program
    .name("guide-compare")
    .description("写作期约束元评测分析侧：配对比较 control 与 guide 两臂")
    .option("--arm <dir>", "实验语料根", DEFAULT_ARM_CORPUS)
    .option("--main <dir>", "主语料根（取同题组人类 reference 作参照）", DEFAULT_MAIN_CORPUS)
    .option("--tier <tier>", `注入档位（必须与生成时一致）：${GUIDE_TIERS.join(" < ")}`, "standard")
    .option("--profile <path>", "eval 报告 JSON 路径；必须与生成时一致，否则注入/留出集合对不上")
    .option("--detector <path>", "外部检测器结果 detector-scores.json 路径")
    .option("--arms <baseline,treatment>", "要比较的两个臂 styleKey（三臂语料跑两两比较时逐次指定）", "control,guide")
    .option("--model <key>", "只保留模型名包含该子串的配对（deepseek / gemini / mimo）；合并结论可能掩盖单模型差异，分层看时用它")
    .action((opts: {arm: string; main: string; tier: string; profile?: string; detector?: string; arms: string; model?: string}) => run(opts));

await program.parseAsync(process.argv);

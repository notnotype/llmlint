import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";
import {DEFAULT_BASE_RULES} from "./base-rules";
import {CURATED_RULE_SLUGS} from "./curated-slugs";
import {DEFAULT_NAMESPACE_ALIASES} from "./namespaces";
import {normalizeNamespace} from "./rules";
import type {CuratedImportJsonReport, CuratedRulesetReport, LintRuleRecord} from "./types";

export type ImportCuratedOptions = {
    sourceRoot: string;
    outputRoot: string;
};

type SourceRuleMode = "text" | "simple" | "regex";

type SourceRuleGroup = {
    name: string;
    enabled: boolean;
    subRules: SourceSubRule[];
};

type SourceSubRule = {
    targets: string[];
    replacements: string[];
    mode: SourceRuleMode;
    remark?: string;
};

type ConvertedTarget = {
    kind: SourceRuleMode;
    pattern: string;
    flags?: string;
};

type CuratedRulesetSpec = {
    id: string;
    title: string;
    description: string;
    sourceFiles: string[];
    forceEnableNamespaces?: string[];
    forceDisableSourceFiles?: string[];
};

type CuratedRuleDraft = {
    id: string;
    canonicalKey: string;
    namespace: string;
    title: string;
    level: "medium";
    enabled: boolean;
    note?: string;
    detector: {
        type: "regex";
        targets: string[];
        flags?: string;
    };
    replacements: string[];
    replacementShapes: Set<string>;
};

const CURATION_SOURCE_FILES = [
    "轻量规则集1.2.json",
    "轻量规则集v1.1.json",
    "通用规则集1.2.json",
    "Claude-保守版.json",
    "Claude-日常版.json",
    "Claude-强力版.json",
    "Gemini-保守版.json",
    "Gemini-日常版.json",
    "Gemini-强力版.json",
    "deepseekv4pro专用.json",
    "极其杀手.json",
];

const CURATED_RULESETS: CuratedRulesetSpec[] = [
    {
        id: "builtin/default",
        title: "llmlint Default Rules",
        description: "llmlint 官方推荐规则集，合并人工维护的 anti-ai-slop 规则与中文规则样本的策展结果。",
        sourceFiles: CURATION_SOURCE_FILES,
        forceEnableNamespaces: ["vocabulary.r18"],
        forceDisableSourceFiles: ["极其杀手.json"],
    },
];

/**
 * 将真实中文规则样本策展合并为官方默认 ruleset。
 */
export async function importCuratedRulesets(options: ImportCuratedOptions): Promise<CuratedImportJsonReport> {
    const sourceRoot = resolve(process.cwd(), options.sourceRoot);
    const outputRoot = resolve(process.cwd(), options.outputRoot);
    const availableFiles = new Set((await readdir(sourceRoot)).filter((file) => file.endsWith(".json")));
    const report: CuratedImportJsonReport = {
        kind: "curated-import",
        sourceRoot,
        outputRoot,
        sourceFiles: availableFiles.size,
        originalTargets: 0,
        uniqueRules: 0,
        converted: {text: 0, simple: 0, regex: 0},
        skipped: [],
        rulesets: [],
    };
    const globalRuleIds = new Set<string>();

    for (const spec of CURATED_RULESETS) {
        for (const sourceFile of spec.sourceFiles) {
            if (!availableFiles.has(sourceFile)) {
                throw new Error(`缺少策展素材文件: ${sourceFile}`);
            }
        }

        const rulesetReport = await buildRuleset(sourceRoot, outputRoot, spec, report);
        for (const rule of await readGeneratedRules(outputRoot, spec.id)) {
            globalRuleIds.add(rule.id);
        }
        report.rulesets.push(rulesetReport);
    }

    report.uniqueRules = globalRuleIds.size;
    return report;
}

export function formatCuratedImportReport(report: CuratedImportJsonReport): string {
    const lines = [
        "已生成 curated llmlint ruleset",
        `来源目录: ${report.sourceRoot}`,
        `输出目录: ${report.outputRoot}`,
        `源文件数: ${report.sourceFiles}`,
        `原始 target 记录: ${report.originalTargets}`,
        `去重后唯一规则 ID: ${report.uniqueRules}`,
        `转换统计: text ${report.converted.text}, simple ${report.converted.simple}, regex ${report.converted.regex}`,
    ];
    for (const ruleset of report.rulesets) {
        lines.push("");
        lines.push(`${ruleset.rulesetId}: ${ruleset.rules} rules (${ruleset.activeRules} active)`);
        lines.push(`  sources: ${ruleset.sourceFiles.join(", ")}`);
        lines.push(`  original targets: ${ruleset.originalTargets}`);
        lines.push(`  replacements merged: ${ruleset.replacementConflicts}`);
    }
    if (report.skipped.length > 0) {
        lines.push("");
        lines.push("跳过规则:");
        for (const skipped of report.skipped) {
            lines.push(`  - ${skipped.file} / ${skipped.group}: ${skipped.reason}${skipped.target ? ` (${skipped.target})` : ""}`);
        }
    }
    return lines.join("\n");
}

async function buildRuleset(
    sourceRoot: string,
    outputRoot: string,
    spec: CuratedRulesetSpec,
    report: CuratedImportJsonReport,
): Promise<CuratedRulesetReport> {
    const drafts = new Map<string, CuratedRuleDraft>();
    const localConverted = {text: 0, simple: 0, regex: 0};
    let originalTargets = 0;

    for (const sourceFile of spec.sourceFiles) {
        const groups = await readSourceRuleFile(join(sourceRoot, sourceFile));
        for (const group of groups) {
            const namespace = normalizeNamespace(group.name);
            const forceEnabled = spec.forceEnableNamespaces?.includes(namespace) ?? false;
            const forceDisabled = spec.forceDisableSourceFiles?.includes(sourceFile) ?? false;
            for (const subRule of group.subRules) {
                for (const target of subRule.targets) {
                    originalTargets++;
                    report.originalTargets++;
                    const convertedTargets = convertTarget(target, subRule.mode);
                    if (!convertedTargets) {
                        report.skipped.push({
                            file: sourceFile,
                            group: group.name,
                            target,
                            reason: `不支持的素材规则模式: ${subRule.mode}`,
                        });
                        continue;
                    }
                    const firstConverted = convertedTargets[0];
                    if (!firstConverted) {
                        report.skipped.push({
                            file: sourceFile,
                            group: group.name,
                            target,
                            reason: "素材规则 target 转换后为空。",
                        });
                        continue;
                    }
                    report.converted[firstConverted.kind]++;
                    localConverted[firstConverted.kind]++;
                    const flags = firstConverted.flags;
                    const patterns = convertedTargets.map((item) => item.pattern);
                    const key = createCanonicalKey(namespace, patterns, flags);
                    const ruleId = createRuleId(namespace, key);
                    const enabled = forceEnabled || (!forceDisabled && group.enabled && !isHighRiskGroup(group.name));
                    const replacements = normalizeReplacements(subRule.replacements);
                    const existing = drafts.get(key);
                    if (existing) {
                        existing.enabled = existing.enabled || enabled;
                        existing.replacementShapes.add(replacements.join("\u001f"));
                        for (const replacement of replacements) {
                            if (!existing.replacements.includes(replacement)) {
                                existing.replacements.push(replacement);
                            }
                        }
                        continue;
                    }
                    drafts.set(key, {
                        id: ruleId,
                        canonicalKey: key,
                        namespace,
                        title: subRule.remark?.trim() || group.name,
                        level: "medium",
                        enabled,
                        note: subRule.remark?.trim() || undefined,
                        detector: {
                            type: "regex",
                            targets: patterns,
                            flags,
                        },
                        replacements: [...replacements],
                        replacementShapes: new Set([replacements.join("\u001f")]),
                    });
                }
            }
        }
    }

    const curatedRules = [...drafts.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(toRuleRecord)
        .map(applyCuratedPatch);
    const rules: LintRuleRecord[] = [
        ...DEFAULT_BASE_RULES,
        ...curatedRules,
    ];
    const groupedRules = groupRulesByNamespace(rules);
    const rulesetRoot = join(outputRoot, ...spec.id.split("/"));
    const rulesRoot = join(rulesetRoot, "rules");
    await mkdir(rulesetRoot, {recursive: true});
    await rm(join(rulesetRoot, "rules.json"), {force: true});
    await rm(rulesRoot, {recursive: true, force: true});
    await mkdir(rulesRoot, {recursive: true});
    await writeFile(join(rulesetRoot, "ruleset.json"), JSON.stringify({
        id: spec.id,
        title: spec.title,
        version: "1.0.0",
        description: spec.description,
        namespaceAliases: DEFAULT_NAMESPACE_ALIASES,
    }, null, 2), "utf-8");
    for (const [namespace, namespaceRules] of groupedRules) {
        const ruleFile = join(rulesetRoot, createNamespaceRulePath(namespace));
        await mkdir(dirname(ruleFile), {recursive: true});
        await writeFile(
            ruleFile,
            JSON.stringify(namespaceRules, null, 2),
            "utf-8",
        );
    }

    return {
        rulesetId: spec.id,
        outputRoot: rulesetRoot,
        sourceFiles: spec.sourceFiles,
        originalTargets,
        rules: rules.length,
        activeRules: rules.filter((rule) => rule.enabled !== false).length,
        converted: localConverted,
        replacementConflicts: [...drafts.values()].filter((draft) => draft.replacementShapes.size > 1).length,
    };
}

async function readGeneratedRules(outputRoot: string, rulesetId: string): Promise<Array<{id: string}>> {
    const rulesetRoot = join(outputRoot, ...rulesetId.split("/"));
    const ruleFiles = await listRuleJsonFiles(rulesetRoot, join(rulesetRoot, "rules"));
    const rules: Array<{id: string}> = [];
    for (const ruleFile of ruleFiles) {
        const source = await readFile(join(rulesetRoot, ruleFile), "utf-8");
        rules.push(...JSON.parse(source) as Array<{id: string}>);
    }
    return rules;
}

function groupRulesByNamespace(rules: LintRuleRecord[]): Map<string, LintRuleRecord[]> {
    const grouped = new Map<string, LintRuleRecord[]>();
    for (const rule of rules) {
        const current = grouped.get(rule.namespace) ?? [];
        current.push(rule);
        grouped.set(rule.namespace, current);
    }
    return new Map([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function createNamespaceRulePath(namespace: string): string {
    const parts = namespace.split(".");
    for (const part of parts) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part)) {
            throw new Error(`namespace 无法作为规则文件路径: ${namespace}`);
        }
    }
    if (parts.length === 1) {
        return `rules/${parts[0]}/index.json`;
    }
    return `rules/${parts.slice(0, -1).join("/")}/${parts.at(-1)}.json`;
}

async function listRuleJsonFiles(rulesetRoot: string, currentRoot: string): Promise<string[]> {
    const entries = await readdir(currentRoot, {withFileTypes: true});
    const files: string[] = [];
    for (const entry of entries) {
        const entryPath = join(currentRoot, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listRuleJsonFiles(rulesetRoot, entryPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".json")) {
            files.push(relative(rulesetRoot, entryPath).replace(/\\/g, "/"));
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}

function toRuleRecord(draft: CuratedRuleDraft): LintRuleRecord {
    return {
        id: draft.id,
        namespace: draft.namespace,
        title: draft.title,
        level: draft.level,
        enabled: draft.enabled,
        note: draft.note,
        source: {
            canonicalKey: draft.canonicalKey,
            importedFrom: "curated-cn-rule-samples",
        },
        detector: draft.detector,
        action: {
            type: "replace",
            replacements: draft.replacements,
        },
    };
}

/**
 * 策展素材之上的稳定人工收敛层：保留来源 canonicalKey，但修正已被 overlap 评测证实的过宽 detector。
 * 规则生成必须经过这里，避免直接修改生成 JSON 后下次重建又回退。
 */
function applyCuratedPatch(rule: LintRuleRecord): LintRuleRecord {
    if (!("detector" in rule)) {
        return rule;
    }
    if (rule.id === "cn.cliche.baguwen.point-reference") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：(?:了|这)一点过宽，当前 eval 为 noise；保留给项目显式开启。",
            source: {...(rule.source ?? {}), version: "rule-curation-v2"},
        };
    }
    if (rule.id === "cn.cliche.baguwen.sudden-moment") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：只检查“突然间/忽然间”，但当前 eval 人类命中更高；普通“突然/忽然”由程度副词 canonical family 判断。",
            source: {...(rule.source ?? {}), version: "rule-curation-v2"},
            detector: {type: "regex", targets: ["(?:突|忽)然间，?"]},
        };
    }
    if (rule.id === "cn.cliche.awkward-fit-judgment") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“格格不入”是常见成语，当前 eval support 很低；只在它替代具体不协调细节时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v2"},
        };
    }
    if (rule.id === "cn.cliche.blank-face") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“面无表情”是常见表情描写，当前 eval support 很低；只在同段模板化重复时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v2"},
        };
    }
    if (rule.id === "cn.action-expression.calm-voice-shell") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“平稳”是普通状态描写，当前 eval support 很低；只在它成为声音状态模板壳时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.action-expression.scream-to-whimper") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：裸“尖叫”不是稳定 AI 痕迹，且替换为“呜咽”会改变动作强度；只在上下文确认过度尖叫时改。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.action-expression.teasing-modifier") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“戏谑”可能是人物口吻或真实语气，当前 eval support 低；只在它替代具体动作时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.action-expression.explicit-teasing-tone") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“明显的戏谑”仍需判断人物关系、叙述距离和对白口吻；与戏谑修饰词同族，不作为默认 Agent 强提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v18"},
        };
    }
    if (rule.id === "cn.action-expression.flat-tone-shell") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“用平淡的语气/语气平淡地”是常见对白状态提示，删除会改变叙述信息；只在它成为反复口气壳时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v18"},
        };
    }
    if (rule.id === "cn.action-expression.force-white-knuckle") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：用力导致泛白可能是有效动作细节，且手部颜色 canonical 已覆盖更典型分句；只在模板化手部特写时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v18"},
        };
    }
    if (rule.id === "cn.action-expression.teasing-attitude-shell") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“戏谑的态度”依赖人物关系和叙述视角；与戏谑修饰词同族，不作为默认 Agent 强提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v18"},
        };
    }
    if (rule.id === "cn.action-expression.tightly-clenched") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“绞得紧紧的”可能是手指、衣料或动作状态，替换为“绞紧”容易改语义；只在重复身体模板时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v18"},
        };
    }
    if (rule.id === "cn.cliche.baguwen.death-grip-adverb") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“得死死的”是常见强度描写，当前 eval support 很低；只在它形成重复身体模板时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.cliche.baguwen.extreme-degree") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“到了极致”是宽泛夸张词，当前 eval support 很低；只在它空转拔高时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.cliche.baguwen.even-is") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“甚至是”是普通递进连接词，不应作为默认 Agent 强提示；只在它形成八股递进壳时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v6"},
        };
    }
    if (rule.id === "cn.cliche.baguwen.inertia-cause") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“因为惯性”可能是动作、物理或心理惯性的真实因果，不应作为默认 Agent 强提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v6"},
        };
    }
    if (rule.id === "cn.cliche.baguwen.shell-noun") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“外壳”是普通名词，只有在抽象包装腔里才需要处理。",
            source: {...(rule.source ?? {}), version: "rule-curation-v6"},
        };
    }
    if (rule.id === "cn.cliche.baguwen.white-knuckles") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前规则是“手指泛白”的窄规则，与 cn.cliche.hand-color-clause 在典型命中上同 span 重复；保留更宽手部颜色 canonical。",
            source: {...(rule.source ?? {}), version: "rule-curation-v6"},
        };
    }
    if (
        rule.id === "cn.cliche.baguwen.irrefutable-tone-colon"
        || rule.id === "cn.cliche.baguwen.irresistible-but"
        || rule.id === "cn.cliche.baguwen.taut-neck"
    ) {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：语气强度和身体紧绷描写依赖人物状态与场景张力；当前无校准支撑，只在模板化拔高时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v21"},
        };
    }
    if (rule.id === "cn.cliche.baguwen.unquestionable-claim") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：已收窄为裸“不容置疑”断言，但旧报告仍为 weak 且当前无命中；只在它空转拔高时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v21"},
            detector: {type: "regex", targets: ["(?:与|却)?不容置疑(?![的地])"]},
        };
    }
    if (rule.id === "cn.cliche.baguwen.vague-amount-noun") {
        return {
            ...rule,
            note: "默认收窄：标点后的“一股”由 cn.modifier.measure.subject-measure-word 覆盖；这里保留句中“一股”和“那股”，避免同 span 量词重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v14"},
            detector: {type: "regex", targets: ["(?<![,，。])一股子?|那股子?"]},
        };
    }
    if (rule.id === "cn.proliferation.mixed.extra-punctuation") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：素材规则会把短前文后的普通逗号、顿号、句号和省略号都当增殖标点，当前 dataset reference 命中 172 次；保留资产给项目显式开启。",
            source: {...(rule.source ?? {}), version: "rule-curation-v23"},
        };
    }
    if (rule.id === "cn.numeral.three.numeral-three") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：裸“三”会命中所有正常数字表达，如“三个夜班/三室一厅/凌晨三点”；保留资产给项目显式开启。",
            source: {...(rule.source ?? {}), version: "rule-curation-v22"},
        };
    }
    if (
        rule.id === "cn.cliche.chest-rise"
        || rule.id === "cn.cliche.chest-vibration"
        || rule.id === "cn.cliche.cold-touch-shell"
        || rule.id === "cn.cliche.drained-face"
        || rule.id === "cn.cliche.hand-appearance-shell"
        || rule.id === "cn.cliche.rough-fingertip-touch"
        || rule.id === "cn.cliche.throat-roll"
        || rule.id === "cn.cliche.tongue-roll"
        || rule.id === "cn.cliche.warm-palm-touch"
        || rule.id === "cn.cliche.words-chewing"
        || rule.id === "cn.cliche.body-reaction.physiological-tears"
    ) {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：身体/触感微细节可能是角色能直接感知的具体画面；只在它变成重复装饰性模板时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v19"},
        };
    }
    if (
        rule.id === "cn.cliche.teeth-pressed-speech"
        || rule.id === "cn.cliche.voice-evaluation-abrupt"
        || rule.id === "cn.cliche.voice-evaluation-clear"
        || rule.id === "cn.cliche.voice-travel-shell"
    ) {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：说话方式和声音空间感可能承载人物声音或场景调度；只在解释过度或重复时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v19"},
        };
    }
    if (
        rule.id === "cn.cliche.body-reaction.mouth-corner-lift-arc"
        || rule.id === "cn.cliche.body-reaction.mouth-corner-smile-arc"
        || rule.id === "cn.cliche.body-reaction.smile-arc-comma-marked"
        || rule.id === "cn.cliche.body-reaction.smile-arc-marked"
    ) {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：素材里的 * 通配符被转换为字面量星号，当前规则只会命中带星号的文本；保留资产，等待重新建模嘴角规则。",
            source: {...(rule.source ?? {}), version: "rule-curation-v6"},
        };
    }
    if (rule.id === "cn.collection.deepseek.decompose-to-understand") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“拆解”是技术说明、分析文和创作讨论里的普通动词，不应作为默认 Agent 强提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v6"},
        };
    }
    if (rule.id === "cn.regex.advanced.few-degree") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：当前数据集扩充后 reference 命中率高于 AI 文本；同时排除“几分钟/几分之一”这类普通表达，避免半截误报。",
            source: {...(rule.source ?? {}), version: "rule-curation-v8"},
            detector: {type: "regex", targets: ["([有了上带添多染])几分(?![钟之])"], flags: "g"},
        };
    }
    if (rule.id === "cn.modifier.measure.specific-measure-word") {
        return {
            ...rule,
            note: "默认收窄：“一股/那股”已由 baguwen.vague-amount-noun 与 subject-measure-word 覆盖；“这种/那种”是普通指示代词，不再作为量词候选。",
            source: {...(rule.source ?? {}), version: "rule-curation-v24"},
            detector: {
                type: "regex",
                targets: ["一丝丝|一丝(?!不[挂苟])|(?<=[这那着被是以用有了和出起到过成为])(?:几分(?!钟)|[一某][种缕抹点道层声])(?=[\\u4e00-\\u9fff])"],
            },
        };
    }
    if (rule.id === "cn.modifier.measure.physiological-label") {
        return {
            ...rule,
            note: "默认收窄：“生理性的/生理层面/生理本能”由 cn.vocabulary.academic-anatomy.physiological-academic-label 覆盖；这里仅保留生理眼泪/快感的独有前缀。",
            source: {...(rule.source ?? {}), version: "rule-curation-v16"},
            detector: {type: "regex", targets: ["生理性?(?=[眼泪]|快感)"]},
        };
    }
    if (rule.id === "cn.vocabulary.academic-anatomy.physiological-academic-label") {
        return {
            ...rule,
            note: "默认收窄：“生理性眼泪/快感”由 cn.modifier.measure.physiological-label 覆盖；这里仅保留分析腔标签。",
            source: {...(rule.source ?? {}), version: "rule-curation-v16"},
            detector: {type: "regex", targets: ["(?:生理层面|生理本能)的?|生理性(?![眼泪]|快感)的?"]},
        };
    }
    if (rule.id === "cn.modifier.heavy-degree-shell") {
        return {
            ...rule,
            note: "默认收窄：带“的/地”的“沉甸甸”已由 cn.modifier.sensory-atmosphere-modifier 覆盖；这里只保留裸“沉甸甸”，避免同 span 重复。",
            source: {...(rule.source ?? {}), version: "rule-curation-v15"},
            detector: {type: "regex", targets: ["(?:显得格外)?沉甸甸(?![的地])"]},
        };
    }
    if (rule.id === "cn.modifier.sensory-atmosphere-modifier") {
        return {
            ...rule,
            note: "默认收窄：“戏谑的/地”由 cn.action-expression.teasing-modifier 覆盖；这里保留其它氛围修饰词。",
            source: {...(rule.source ?? {}), version: "rule-curation-v17"},
            detector: {
                type: "regex",
                targets: ["(?:略显粗糙|粗糙|逼仄|惊人|狡黠|玩味|餍足|甜腻|黏腻|磁性|低哑|喑哑|沙哑|嘶哑|微哑|沉甸甸|亮晶晶|直勾勾|硬生生)(?:的|地)"],
            },
        };
    }
    if (rule.id === "cn.modifier.stacked-degree-adverbs") {
        return {
            ...rule,
            note: "默认收窄：移除裸“突然/忽然”和“稍微/略微/稍稍”等低信号普通副词，并移除会半截命中“凶猛的/迅猛的”的“猛的”；保留更像装饰性堆叠或 AI 高频动作模板的分支。",
            source: {...(rule.source ?? {}), version: "rule-curation-v25"},
            detector: {
                type: "regex",
                targets: ["(?:一丝丝|极其|极度|极致|死死|紧紧|深深|浅浅|浓浓|极轻微|轻微|微微|完全|彻底|格外|分外|乃至|全然|猛地|勐地|近乎于|近乎|无意识地|下意识地|不自觉地|习惯性地)(?:的|地)?"],
            },
        };
    }
    if (rule.id === "cn.tone.tone-placeholder") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：素材里的 * 通配符被转换为字面量星号，当前规则只会命中“语气*”这类异常文本；保留资产等待重新建模。",
            source: {...(rule.source ?? {}), version: "rule-curation-v6"},
        };
    }
    if (rule.id === "cn.punctuation.dash.dash-alone-to-comma") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：裸破折号在中文小说中常用于插入解释、悬念、拖长音和节奏停顿；替换成逗号会改变语气，当前 dataset reference 命中 21 次。",
            source: {...(rule.source ?? {}), version: "rule-curation-v23"},
        };
    }
    if (
        rule.id === "cn.metaphor.like.bare-like-placeholder"
        || rule.id === "cn.metaphor.like.double-like-is"
        || rule.id === "cn.metaphor.like.double-seems-like"
        || rule.id === "cn.metaphor.like.like-doing"
        || rule.id === "cn.metaphor.like.like-is-doing"
        || rule.id === "cn.metaphor.like.like-is-placeholder"
        || rule.id === "cn.metaphor.like.unlike-but-like"
    ) {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：素材里的 * 通配符被转换为字面量星号，当前规则只会命中带星号的占位文本；保留资产，等待重新建模比喻壳。",
            source: {...(rule.source ?? {}), version: "rule-curation-v7"},
        };
    }
    if (rule.id === "cn.cliche.quote-meta-as-if" || rule.id === "cn.cliche.quote-meta-like" || rule.id === "cn.cliche.quote-meta-seems") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“仿佛/像/好像在说”需要判断前文是否已有足够动作和语气；当前 eval support 很低，只在它解释过度时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.cliche.gaze-emotion-container") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“眼神里带着…”可能是正常叙事压缩，当前 eval 仅 weak；只在它替代具体行动或心理推进时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.cliche.teeth-clenched-speech") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“从牙缝里挤出”是常见咬字描写，当前 eval support 偏低；只在同类模板重复时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.cliche.trailing-callus-clause") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：茧子细节高度依赖题材和人物设定，当前 eval support 很低；只在它成为无功能尾部分句时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.cliche.voice-emotion-container") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“声音/语气里带着…”可能是有效对白提示，当前 eval support 很低；只在它解释过度或重复时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.cliche.vague-transition-phrase") {
        return {
            ...rule,
            note: "默认收窄：裸“近乎”在当前 reference 中出现真实用法（如“近乎成本价”），Agent 默认只保留“取而代之的是”和更明确的“近乎于”。",
            source: {...(rule.source ?? {}), version: "rule-curation-v9"},
            detector: {type: "regex", targets: ["近乎于|取而代之的[,，]?是"]},
        };
    }
    if (rule.id === "cn.cliche.trailing-sensory-clause") {
        return {
            ...rule,
            note: "默认收窄：尾部分句只看叙述层，避免系统面板和整句对白误报；Agent 只处理无功能感官/语气尾巴，保留必要动作、物性和信息细节。",
            source: {...(rule.source ?? {}), version: "rule-curation-v10"},
            scope: {layer: "narrative"},
        };
    }
    if (rule.id === "cn.cliche.trailing-sound-clause") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“发出…声/响”常是正常动作音效，当前 eval 仅 weak；只在它成为无功能尾部分句或音效模板重复时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v13"},
        };
    }
    if (rule.id === "cn.cliche.hand-color-clause") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：手指/骨节泛白可能是具体动作压力或身体反应，旧报告 support 不足；只在重复身体模板时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v20"},
        };
    }
    if (rule.id === "cn.cliche.direct-mouth-arc" || rule.id === "cn.cliche.trailing-mouth-arc-clause") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：嘴角弧度家族旧报告 support 不足，且 direct/trailing 形态会同 span 重复；只在嘴角弧度成为模板化表情时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v20"},
        };
    }
    if (rule.id === "cn.cliche.cup-collision" || rule.id === "cn.cliche.table-cup-touch" || rule.id === "cn.cliche.knuckle-crack") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：杯子/杯底/骨节的接触音效可能是正常动作细节；与 trailing-sound-clause 同类，只在无功能音效模板重复时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v18"},
        };
    }
    if (rule.id === "cn.action-expression.mouth-corner-arc") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：裸“嘴/唇角…弧度”旧报告 support 不足，且尾部分句场景已有 cn.cliche.trailing-mouth-arc-clause 作为 canonical。",
            source: {...(rule.source ?? {}), version: "rule-curation-v12"},
        };
    }
    if (rule.id === "cn.action-expression.mouth-corner-hook") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：裸“嘴角勾”过宽，容易与更长嘴角弧度规则产生半截候选；保留给项目显式开启。",
            source: {...(rule.source ?? {}), version: "rule-curation-v2"},
        };
    }
    if (rule.id === "cn.action-expression.rough-manner-modifier") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：旧报告为 strong，但裸“粗重/粗暴/疯狂”会命中呼吸、字体、码字、能量、心跳和真实动作；只在它成为空泛强度修饰时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v22"},
        };
    }
    if (rule.id === "cn.sentence.compound.immediate-delay-shell") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“并没有立刻”是普通叙述短语，当前 eval support 很低；只在它形成拖沓句壳时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v2"},
        };
    }
    if (rule.id === "cn.sentence.compound.unrealized-subject-preface") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：带主语的“并没有…而是”可能是正常对比，当前 eval 人类侧命中；只在否定铺垫无功能时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v2"},
        };
    }
    if (rule.id === "cn.sentence.compound.ordinary-days-preface") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：“平日里”是普通时间参照，当前 eval support 低；只在它成为可删除的参照依赖句壳时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
        };
    }
    if (rule.id === "cn.sentence.compound.single-negative-contrast") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：旧“不是…而是”regex 与 story-deslop handler 职责接近，且删前半句易改语义；排除“并不是…而是”，交给 contrastive-turn-preface。",
            source: {...(rule.source ?? {}), version: "rule-curation-v17"},
            detector: {type: "regex", targets: ["(?<!不是不)([\\u4e00-\\u9fff]+)(?<!并)不是[\\u4e00-\\u9fff，、“”‘’]{1,20}[，,]而是"]},
        };
    }
    if (rule.id === "cn.sentence.compound.contrastive-turn-preface") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：泛“不是/并非/没有…而是/反而”会命中合法对白、设定解释和事实辨析；默认 Agent 只保留 story-deslop 的高信号否定对比规则。",
            source: {...(rule.source ?? {}), version: "rule-curation-v11"},
        };
    }
    if (rule.id === "cn.sentence.compound.dialogue-echo-after-quote" || rule.id === "cn.sentence.compound.setting-space-preface") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：对白后的回声句和场域前置句可能服务节奏、停顿或空间调度；只在它成为空转句壳时删。",
            source: {...(rule.source ?? {}), version: "rule-curation-v21"},
        };
    }
    if (
        rule.id === "cn.sentence.compound.generic-comparison-tone"
        || rule.id === "cn.sentence.compound.weather-tone-chat"
        || rule.id === "cn.sentence.compound.weather-tone-chat-today"
        || rule.id === "cn.sentence.compound.weather-tone-direct-state"
        || rule.id === "cn.sentence.compound.weather-tone-discuss"
        || rule.id === "cn.sentence.compound.weather-tone-discussion"
    ) {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：天气/闲聊类口气比喻可能是人物反差或黑色幽默，替换为“平静地”会抹掉语气；只在固定口气壳重复时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v18"},
        };
    }
    if (rule.id === "cn.cliche.body-reaction.controlling-gaze") {
        return {
            ...rule,
            review: "human",
            note: "默认交人工：已要求出现“目光/眼神”，但当前 eval 仍为 noise；只在目光描写替代具体动作或心理推进时修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v4"},
            detector: {type: "regex", targets: ["(?:探究|审视|掌控)(?:着)?(?:的|地)?(?:目光|眼神)"]},
        };
    }
    if (rule.id === "cn.cliche.hand-whitening-detail") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：与 cn.cliche.hand-color-clause 在当前 eval 中 100% 同 span 重叠；保留更宽 canonical，避免手部泛白细节重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.proliferation.mixed.repeated-de-pairs") {
        return {
            ...rule,
            note: "默认保留 Agent：当前 dataset 强判别，但不等于删除所有“的/地”并列；只压缩装饰性形容词堆叠，保留具体物性、动作条件和有信息量的排比。",
            source: {...(rule.source ?? {}), version: "rule-curation-v22"},
        };
    }
    if (rule.id === "cn.cliche.mid-sentence-summary") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.cliche.vague-transition-phrase 与 cn.cliche.trailing-sensory-clause 覆盖；保留 canonical，避免句中总结腔重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.cliche.mouth-corner-arc-cliche") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.cliche.trailing-mouth-arc-clause 覆盖；保留尾部分句 canonical，避免嘴角弧度重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.metaphor.inserted-simile-shell") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.metaphor.simile-modifier-shell 覆盖；保留更宽比喻修饰 canonical，避免同一比喻壳重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.modifier.absolute-judgment-modifier") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.modifier.absolute-claim-modifier 覆盖；保留更宽 absolute claim canonical，避免绝对判断修饰重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.modifier.extreme-sensory-simile") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.modifier.excessive-state-simile 覆盖；保留更宽状态修饰 canonical，避免夸张比附修饰重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.modifier.grandiose-simile-modifier") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.modifier.excessive-state-simile 覆盖；保留更宽状态修饰 canonical，避免夸张比附修饰重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.modifier.hollow-state-modifier") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.modifier.template-state-modifier 覆盖；保留模板化状态 canonical，避免空洞状态修饰重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.modifier.sensory-atmosphere-core") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.modifier.sensory-atmosphere-modifier 覆盖；保留更宽氛围修饰 canonical，避免氛围形副词重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.modifier.template-atmosphere-modifier") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.modifier.sensory-atmosphere-modifier 覆盖；保留更宽氛围修饰 canonical，避免模板化氛围修饰重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    if (rule.id === "cn.modifier.template-state-modifier") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：当前 eval 中 100% 被 cn.modifier.excessive-state-simile 覆盖；保留更宽状态修饰 canonical，避免模板化状态修饰重复提示。",
            source: {...(rule.source ?? {}), version: "rule-curation-v3"},
        };
    }
    return rule;
}

async function readSourceRuleFile(filePath: string): Promise<SourceRuleGroup[]> {
    const raw = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
    if (!Array.isArray(raw)) {
        throw new Error(`规则策展素材必须是数组: ${basename(filePath)}`);
    }
    return raw.map((value) => readSourceRuleGroup(value, basename(filePath)));
}

function readSourceRuleGroup(value: unknown, fileName: string): SourceRuleGroup {
    if (!isObject(value)) {
        throw new Error(`${fileName} 中的规则组必须是对象。`);
    }
    const name = value.name;
    if (typeof name !== "string" || name.trim().length === 0) {
        throw new Error(`${fileName} 中的规则组 name 必须是非空字符串。`);
    }
    const enabled = value.enabled;
    if (enabled !== undefined && typeof enabled !== "boolean") {
        throw new Error(`${fileName} / ${name} enabled 必须是布尔值。`);
    }
    const subRules = value.subRules;
    if (!Array.isArray(subRules)) {
        throw new Error(`${fileName} / ${name} subRules 必须是数组。`);
    }
    return {
        name,
        enabled: enabled !== false,
        subRules: subRules.map((item) => readSourceSubRule(item, fileName, name)),
    };
}

function readSourceSubRule(value: unknown, fileName: string, groupName: string): SourceSubRule {
    if (!isObject(value)) {
        throw new Error(`${fileName} / ${groupName} subRule 必须是对象。`);
    }
    const mode = value.mode;
    if (mode !== "text" && mode !== "simple" && mode !== "regex") {
        throw new Error(`${fileName} / ${groupName} mode 必须是 text、simple 或 regex。`);
    }
    return {
        targets: readStringArray(value.targets, `${fileName} / ${groupName} targets`),
        replacements: readStringArray(value.replacements, `${fileName} / ${groupName} replacements`, true),
        mode,
        remark: typeof value.remark === "string" ? value.remark : undefined,
    };
}

function convertTarget(target: string, mode: SourceRuleMode): ConvertedTarget[] | null {
    if (mode === "text") {
        return [{kind: "text", pattern: escapeRegex(target)}];
    }
    if (mode === "simple") {
        return splitTopLevelAlternatives(target)
            .map((part) => ({kind: "simple", pattern: convertSimplePattern(part)}));
    }
    if (mode === "regex") {
        return [parseRegexTarget(target)];
    }
    return null;
}

function parseRegexTarget(target: string): ConvertedTarget {
    if (!target.startsWith("/")) {
        return {kind: "regex", pattern: target};
    }
    const lastSlash = target.lastIndexOf("/");
    if (lastSlash <= 0) {
        return {kind: "regex", pattern: target};
    }
    const flags = target.slice(lastSlash + 1);
    return {
        kind: "regex",
        pattern: target.slice(1, lastSlash),
        flags: flags || undefined,
    };
}

function convertSimplePattern(target: string): string {
    let result = "";
    let index = 0;
    while (index < target.length) {
        const char = target[index];
        if (char === undefined) {
            break;
        }
        if (char === "{") {
            const end = target.indexOf("}", index + 1);
            if (end === -1) {
                result += escapeRegex(char);
                index++;
                continue;
            }
            const alternatives = target
                .slice(index + 1, end)
                .split(",")
                .map((item) => escapeRegex(item.trim()))
                .filter((item) => item.length > 0);
            result += alternatives.length > 0 ? `(?:${alternatives.join("|")})` : "";
            index = end + 1;
            continue;
        }
        result += char === "?" ? "?" : escapeRegex(char);
        index++;
    }
    return result;
}

function splitTopLevelAlternatives(target: string): string[] {
    const result: string[] = [];
    let current = "";
    let braceDepth = 0;

    for (let index = 0; index < target.length; index++) {
        const char = target[index];
        if (char === undefined) {
            break;
        }
        if (char === "{") {
            braceDepth++;
            current += char;
            continue;
        }
        if (char === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
            current += char;
            continue;
        }
        if (char === "|" && braceDepth === 0) {
            const part = current.trim();
            if (part.length > 0) {
                result.push(part);
            }
            current = "";
            continue;
        }
        current += char;
    }

    const last = current.trim();
    if (last.length > 0) {
        result.push(last);
    }
    return result.length > 0 ? result : [target];
}

function createCanonicalKey(namespace: string, patterns: string[], flags: string | undefined): string {
    return `${namespace}\t${flags ?? ""}\t${patterns.join("\u001f")}`;
}

function createRuleId(namespace: string, canonicalKey: string): string {
    const slug = CURATED_RULE_SLUGS[canonicalKey];
    if (!slug) {
        throw new Error(`缺少中文规则 slug 映射: ${canonicalKey}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new Error(`中文规则 slug 只能包含小写字母、数字和连字符: ${slug}`);
    }
    return `cn.${namespace}.${slug}`;
}

function normalizeReplacements(replacements: string[]): string[] {
    return replacements.length === 0 ? [""] : [...replacements];
}

function isHighRiskGroup(groupName: string): boolean {
    return groupName.includes("[可选]")
        || groupName.includes("[选开]")
        || groupName.includes("冲突");
}

function readStringArray(value: unknown, fieldName: string, allowEmpty = false): string[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new Error(`${fieldName} 必须是字符串数组。`);
    }
    if (!allowEmpty && value.length === 0) {
        throw new Error(`${fieldName} 不能为空。`);
    }
    return [...value];
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

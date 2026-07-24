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
    if (rule.id === "cn.cliche.baguwen.unquestionable-claim") {
        return {
            ...rule,
            note: "默认收窄：带“的/地”的绝对判断修饰已由 cn.modifier.absolute-claim-modifier 覆盖；这里只保留裸“不容置疑”断言，避免同 span 重复。",
            source: {...(rule.source ?? {}), version: "rule-curation-v10"},
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
    if (rule.id === "cn.tone.tone-placeholder") {
        return {
            ...rule,
            enabled: false,
            note: "默认关闭：素材里的 * 通配符被转换为字面量星号，当前规则只会命中“语气*”这类异常文本；保留资产等待重新建模。",
            source: {...(rule.source ?? {}), version: "rule-curation-v6"},
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
            note: "默认收窄：尾部分句只看叙述层，避免系统面板和整句对白里的“带着/声音/语气…”被当成可删叙述尾巴。",
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
            note: "默认交人工：旧“不是…而是”regex 与 story-deslop handler 职责接近，且删前半句易改语义；默认不再喂给 Agent 强修。",
            source: {...(rule.source ?? {}), version: "rule-curation-v5"},
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

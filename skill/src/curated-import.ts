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
    if (rule.id !== "cn.cliche.baguwen.sudden-moment" || !("detector" in rule)) {
        return rule;
    }
    return {
        ...rule,
        note: "只检查“突然间/忽然间”；普通“突然/忽然”由程度副词 canonical family 判断，避免同 span 重复命中。",
        source: {...rule.source, version: "creative-profile-v1"},
        detector: {type: "regex", targets: ["(?:突|忽)然间，?"]},
    };
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

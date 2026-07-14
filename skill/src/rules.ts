import {existsSync} from "node:fs";
import {readFile, readdir, stat} from "node:fs/promises";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {DEFAULT_NAMESPACE_ALIASES, DEFAULT_NAMESPACE_POLICY, DEFAULT_RULE_POLICY} from "./namespaces";
import {materializeRules} from "./rule-registry";
import type {
    ActiveRuleRecord,
    DeclarativeRuleRecord,
    Fixability,
    HandlerRuleRecord,
    LintRuleRecord,
    LoadedRules,
    NormalizedLlmlintConfig,
    NormalizedRuleOverride,
    RegistryDiagnostic,
    Review,
    RuleLevel,
    RuleRegistryCatalogItem,
    RulesetManifest,
} from "./types";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULESETS_ROOT = resolve(SKILL_ROOT, "rulesets");
const RULES_DIRECTORY = "rules";

export type LoadedRuleCatalog = {
    catalog: RuleRegistryCatalogItem[];
    diagnostics: RegistryDiagnostic[];
    namespaceAliases: Record<string, string>;
    loadedRulesets: string[];
};

/**
 * 加载 ruleset，合并成扁平 Rule Registry，并应用 ruleset / namespace / rule 覆盖。
 */
export async function loadRules(config: NormalizedLlmlintConfig): Promise<LoadedRules> {
    const source = await loadRuleCatalog(config);
    return materializeRules({
        catalog: source.catalog,
        config,
        diagnostics: source.diagnostics,
        namespaceAliases: source.namespaceAliases,
        loadedRulesets: source.loadedRulesets,
    });
}

/**
 * 加载完整规则目录，不应用最终启停覆盖。浏览器构建期用它预烘 catalog，
 * 客户端再按本地设置调用 materializeRules。
 */
export async function loadRuleCatalog(config: NormalizedLlmlintConfig): Promise<LoadedRuleCatalog> {
    const diagnostics: RegistryDiagnostic[] = [];
    const registry = new Map<string, RuleRegistryCatalogItem>();
    const namespaceAliases: Record<string, string> = {...DEFAULT_NAMESPACE_ALIASES};
    const loadedRulesets: string[] = [];

    for (const rulesetId of config.rulesets) {
        const rulesetSetting = config.rulesetOverrides[rulesetId];
        const manifest = await loadManifest(rulesetId);
        Object.assign(namespaceAliases, manifest.namespaceAliases ?? {});

        const rules = await loadRulesetRecords(manifest);
        let mergedRules = 0;
        let skippedByRulesetOff = 0;
        for (const rawRule of rules) {
            const normalized = normalizeRule(rawRule, manifest, namespaceAliases, diagnostics);
            if (!normalized) {
                continue;
            }
            if (rulesetSetting === "off" && !isExplicitlyEnabled(normalized, config, namespaceAliases)) {
                skippedByRulesetOff++;
                continue;
            }

            const previous = registry.get(normalized.id);
            if (previous) {
                diagnostics.push({
                    level: "warning",
                    code: "rule-override",
                    message: `规则 ${normalized.id} 被规则包 ${manifest.id} 覆盖；旧来源为 ${previous.rule.ruleset}。`,
                    ruleId: normalized.id,
                    namespace: normalized.namespace,
                    previousRuleset: previous.rule.ruleset,
                    nextRuleset: manifest.id,
                });
            }

            registry.set(normalized.id, {
                rule: normalized,
                defaultEnabled: normalized.enabled !== false,
            });
            mergedRules++;
        }

        if (rulesetSetting === "off") {
            diagnostics.push({
                level: "info",
                code: "ruleset-disabled",
                message: `规则包 ${manifest.id} 已被配置关闭，跳过 ${skippedByRulesetOff} 条规则，显式启用 ${mergedRules} 条规则。`,
                ruleset: manifest.id,
            });
        }
        if (rulesetSetting !== "off" || mergedRules > 0) {
            loadedRulesets.push(manifest.id);
        }
    }

    return {
        catalog: [...registry.values()],
        diagnostics,
        namespaceAliases,
        loadedRulesets,
    };
}

export function normalizeNamespace(namespace: string, aliases: Record<string, string> = DEFAULT_NAMESPACE_ALIASES): string {
    return aliases[namespace] ?? namespace;
}

async function loadManifest(rulesetId: string): Promise<RulesetManifest> {
    const root = resolveRulesetRoot(rulesetId);
    const manifest = await readJson(resolve(root, "ruleset.json"), `规则包 ${rulesetId} 的 ruleset.json`);
    if (!isObject(manifest)) {
        throw new Error(`规则包 ${rulesetId} 的 ruleset.json 必须是对象。`);
    }
    const id = readRequiredString(manifest, "id", `规则包 ${rulesetId}.id`);
    const title = readRequiredString(manifest, "title", `规则包 ${rulesetId}.title`);
    const version = readRequiredString(manifest, "version", `规则包 ${rulesetId}.version`);
    rejectRemovedManifestField(manifest, "ruleFiles", rulesetId);
    rejectRemovedManifestField(manifest, "rulesRoot", rulesetId);
    const description = readOptionalString(manifest, "description", `规则包 ${rulesetId}.description`);
    const namespaceAliases = readOptionalStringRecord(manifest, "namespaceAliases", `规则包 ${rulesetId}.namespaceAliases`);
    if (id !== rulesetId) {
        throw new Error(`规则包路径 ${rulesetId} 与 manifest id ${id} 不一致。`);
    }
    return {id, title, version, description, namespaceAliases};
}

async function loadRulesetRecords(manifest: RulesetManifest): Promise<LintRuleRecord[]> {
    const root = resolveRulesetRoot(manifest.id);
    const rulesRoot = resolve(root, RULES_DIRECTORY);
    if (existsSync(resolve(root, "rules.json"))) {
        throw new Error(`规则包 ${manifest.id} 不再支持根目录 rules.json；请把规则放入 ${RULES_DIRECTORY}/。`);
    }
    if (!existsSync(rulesRoot)) {
        throw new Error(`规则包 ${manifest.id} 必须包含 ${RULES_DIRECTORY}/ 规则目录。`);
    }
    if (!(await stat(rulesRoot)).isDirectory()) {
        throw new Error(`规则包 ${manifest.id} 的 ${RULES_DIRECTORY}/ 必须是规则目录。`);
    }
    const ruleFiles = await listRuleJsonFiles(root, rulesRoot);
    if (ruleFiles.length === 0) {
        throw new Error(`规则包 ${manifest.id} 的 ${RULES_DIRECTORY}/ 目录下没有 .json 规则文件。`);
    }
    const records: LintRuleRecord[] = [];

    for (const ruleFile of ruleFiles) {
        const filePath = resolve(root, ruleFile);
        const rules = await readJson(filePath, `规则包 ${manifest.id} 的 ${ruleFile}`);
        if (!Array.isArray(rules)) {
            throw new Error(`规则包 ${manifest.id} 的 ${ruleFile} 必须是数组。`);
        }
        records.push(...rules.map((rule, index) => validateRuleRecord(rule, `${manifest.id}.${ruleFile}[${index}]`)));
    }
    return records;
}

function normalizeRule(
    rule: LintRuleRecord,
    manifest: RulesetManifest,
    aliases: Record<string, string>,
    diagnostics: RegistryDiagnostic[],
): ActiveRuleRecord | null {
    if ("handler" in rule) {
        diagnostics.push({
            level: "warning",
            code: "handler-not-implemented",
            message: `规则 ${rule.id} 是 handler rule；llmlint v1 只登记诊断，不执行第三方 handler。`,
            ruleset: manifest.id,
            ruleId: rule.id,
            namespace: normalizeNamespace(rule.namespace, aliases),
        });
        return null;
    }

    const namespace = normalizeNamespace(rule.namespace, aliases);
    if (namespace !== rule.namespace) {
        diagnostics.push({
            level: "info",
            code: "namespace-alias",
            message: `namespace ${rule.namespace} 已归一化为 ${namespace}。`,
            ruleset: manifest.id,
            ruleId: rule.id,
            namespace,
        });
    }

    // 解析最终 review / fixability，优先级：规则自带字段 > 命名空间策略表 > detector/action 推导。
    // fixability 最后还要受规则能力约束：只有 regex + replace 才能进入 auto/candidate。
    const namespacePolicy = DEFAULT_NAMESPACE_POLICY[namespace];
    const rulePolicy = DEFAULT_RULE_POLICY[rule.id];
    return {
        ...rule,
        namespace,
        ruleset: manifest.id,
        review: rule.review ?? rulePolicy?.review ?? namespacePolicy?.review ?? deriveReview(rule),
        fixability: resolveFixability(rule, rulePolicy?.fixability ?? namespacePolicy?.fixability),
    };
}

/** detector/action 推导默认审查受众：默认都交给 Agent，再由命名空间策略表下调到 human/none。 */
function deriveReview(_rule: DeclarativeRuleRecord): Review {
    return "agent";
}

/** detector/action 推导默认修复能力：语义 replace 只是模板，不自动获得可应用权限。 */
function deriveFixability(_rule: DeclarativeRuleRecord): Fixability {
    return "manual";
}

function resolveFixability(rule: DeclarativeRuleRecord, policyFixability: Fixability | undefined): Fixability {
    const declared = rule.fixability ?? policyFixability ?? deriveFixability(rule);
    if (declared === "manual") {
        return "manual";
    }
    if (rule.detector.type !== "regex" || rule.action.type !== "replace") {
        return "manual";
    }
    return declared;
}

function isExplicitlyEnabled(rule: ActiveRuleRecord, config: NormalizedLlmlintConfig, aliases: Record<string, string>): boolean {
    // 与 applyOverride 共用同一套语义：是否「显式启用」只看覆盖 patch 里的 enabled。
    // rule 覆盖显式设了 enabled 就由它决定；否则看 namespace 覆盖是否显式 enable。
    // 纯属性对象（只设 review/fixability/level，无 enabled）不算显式启用，不复活被关闭的 ruleset。
    const ruleOverride = config.rules[rule.id];
    if (ruleOverride?.enabled !== undefined) {
        return ruleOverride.enabled;
    }
    const namespaceOverride = resolveNamespaceOverride(config.namespaces, rule.namespace, aliases);
    return namespaceOverride?.enabled === true;
}

function resolveNamespaceOverride(overrides: Record<string, NormalizedRuleOverride>, namespace: string, aliases: Record<string, string>): NormalizedRuleOverride | undefined {
    for (const [key, override] of Object.entries(overrides)) {
        if (normalizeNamespace(key, aliases) === namespace) {
            return override;
        }
    }
    return undefined;
}

function resolveRulesetRoot(rulesetId: string): string {
    const root = resolve(RULESETS_ROOT, rulesetId);
    const relativePath = relative(RULESETS_ROOT, root);
    if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
        throw new Error(`规则包 ID 不允许跳出 rulesets 目录: ${rulesetId}`);
    }
    if (!existsSync(root)) {
        throw new Error(`规则包不存在: ${rulesetId}`);
    }
    return root;
}

async function readJson(filePath: string, sourceLabel: string): Promise<unknown> {
    const source = await readFile(filePath, "utf-8");
    try {
        return JSON.parse(source) as unknown;
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`${sourceLabel} 不是合法 JSON：${error.message}`);
        }
        throw error;
    }
}

async function listRuleJsonFiles(rulesetRoot: string, currentRoot: string): Promise<string[]> {
    const entries = await readdir(currentRoot, {withFileTypes: true});
    const files: string[] = [];
    for (const entry of entries) {
        const entryPath = resolve(currentRoot, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listRuleJsonFiles(rulesetRoot, entryPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".json")) {
            files.push(toRulesetRelativePath(rulesetRoot, entryPath));
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}

function toRulesetRelativePath(rulesetRoot: string, filePath: string): string {
    return relative(rulesetRoot, filePath).replace(/\\/g, "/");
}

function rejectRemovedManifestField(manifest: Record<string, unknown>, key: string, rulesetId: string): void {
    if (manifest[key] !== undefined) {
        throw new Error(`规则包 ${rulesetId}.ruleset.json 不再支持 ${key}；规则文件固定从 ${RULES_DIRECTORY}/ 递归加载。`);
    }
}

function validateRuleRecord(value: unknown, fieldName: string): LintRuleRecord {
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是规则对象。`);
    }

    const base = {
        id: readRequiredString(value, "id", `${fieldName}.id`),
        namespace: readRequiredString(value, "namespace", `${fieldName}.namespace`),
        ruleset: readOptionalString(value, "ruleset", `${fieldName}.ruleset`),
        title: readRequiredString(value, "title", `${fieldName}.title`),
        level: readRuleLevel(value.level, `${fieldName}.level`),
        review: readOptionalReview(value, "review", `${fieldName}.review`),
        fixability: readOptionalFixability(value, "fixability", `${fieldName}.fixability`),
        enabled: readOptionalBoolean(value, "enabled", `${fieldName}.enabled`),
        note: readOptionalString(value, "note", `${fieldName}.note`),
        examples: readExamples(value.examples, `${fieldName}.examples`),
        source: readSource(value.source, `${fieldName}.source`),
    };

    if ("handler" in value) {
        const handler = readHandler(value.handler, `${fieldName}.handler`);
        return compactObject({...base, handler}) as LintRuleRecord;
    }

    const detector = readDetector(value.detector, `${fieldName}.detector`);
    const action = readAction(value.action, `${fieldName}.action`);
    return compactObject({...base, detector, action}) as LintRuleRecord;
}

function readDetector(value: unknown, fieldName: string): DeclarativeRuleRecord["detector"] {
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是 detector 对象。`);
    }
    if (value.type === "regex") {
        return {
            type: "regex",
            targets: readRequiredStringArray(value, "targets", `${fieldName}.targets`),
            flags: readOptionalString(value, "flags", `${fieldName}.flags`),
        };
    }
    if (value.type === "llm") {
        return {
            type: "llm",
            prompt: readRequiredString(value, "prompt", `${fieldName}.prompt`),
        };
    }
    throw new Error(`${fieldName}.type 必须是 regex 或 llm。`);
}

function readAction(value: unknown, fieldName: string): DeclarativeRuleRecord["action"] {
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是 action 对象。`);
    }
    if (value.type === "replace") {
        return {
            type: "replace",
            replacements: readReplacementArray(value, "replacements", `${fieldName}.replacements`),
        };
    }
    if (value.type === "suggest") {
        return {
            type: "suggest",
            message: readRequiredString(value, "message", `${fieldName}.message`),
        };
    }
    throw new Error(`${fieldName}.type 必须是 replace 或 suggest。`);
}

function readHandler(value: unknown, fieldName: string): HandlerRuleRecord["handler"] {
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是 handler 对象。`);
    }
    if (value.type !== "module") {
        throw new Error(`${fieldName}.type 第一版只支持 module。`);
    }
    const handlerPath = readRequiredString(value, "path", `${fieldName}.path`);
    if (handlerPath.includes("..") || handlerPath.startsWith("/") || handlerPath.startsWith("\\")) {
        throw new Error(`${fieldName}.path 必须是 ruleset 内部相对路径。`);
    }
    return {
        type: "module",
        path: handlerPath,
        export: readOptionalString(value, "export", `${fieldName}.export`),
    };
}

function readExamples(value: unknown, fieldName: string): BaseExample[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error(`${fieldName} 必须是数组。`);
    }
    return value.map((item, index) => {
        if (!isObject(item)) {
            throw new Error(`${fieldName}[${index}] 必须是对象。`);
        }
        return compactObject({
            bad: readRequiredString(item, "bad", `${fieldName}[${index}].bad`),
            good: readOptionalString(item, "good", `${fieldName}[${index}].good`),
            reason: readOptionalString(item, "reason", `${fieldName}[${index}].reason`),
        });
    });
}

type BaseExample = NonNullable<DeclarativeRuleRecord["examples"]>[number];

function readSource(value: unknown, fieldName: string): DeclarativeRuleRecord["source"] {
    if (value === undefined) {
        return undefined;
    }
    if (!isObject(value)) {
        throw new Error(`${fieldName} 必须是对象。`);
    }
    for (const key of Object.keys(value)) {
        if (key !== "version" && key !== "canonicalKey" && key !== "importedFrom") {
            throw new Error(`${fieldName}.${key} 不是允许的 source 字段。`);
        }
    }
    return compactObject({
        version: readOptionalString(value, "version", `${fieldName}.version`),
        canonicalKey: readOptionalString(value, "canonicalKey", `${fieldName}.canonicalKey`),
        importedFrom: readOptionalString(value, "importedFrom", `${fieldName}.importedFrom`),
    });
}

function readRequiredString(value: Record<string, unknown>, key: string, fieldName: string): string {
    const raw = value[key];
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new Error(`${fieldName} 必须是非空字符串。`);
    }
    return raw;
}

function readOptionalString(value: Record<string, unknown>, key: string, fieldName: string): string | undefined {
    const raw = value[key];
    if (raw === undefined) {
        return undefined;
    }
    if (typeof raw !== "string") {
        throw new Error(`${fieldName} 必须是字符串。`);
    }
    return raw;
}

function readOptionalBoolean(value: Record<string, unknown>, key: string, fieldName: string): boolean | undefined {
    const raw = value[key];
    if (raw === undefined) {
        return undefined;
    }
    if (typeof raw !== "boolean") {
        throw new Error(`${fieldName} 必须是布尔值。`);
    }
    return raw;
}

function readRequiredStringArray(value: Record<string, unknown>, key: string, fieldName: string): string[] {
    const raw = value[key];
    if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
        throw new Error(`${fieldName} 必须是字符串数组。`);
    }
    const normalized = raw.map((item) => item.trim()).filter((item) => item.length > 0);
    if (normalized.length === 0) {
        throw new Error(`${fieldName} 至少需要一个非空字符串。`);
    }
    return normalized;
}

function readReplacementArray(value: Record<string, unknown>, key: string, fieldName: string): string[] {
    const raw = value[key];
    if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
        throw new Error(`${fieldName} 必须是字符串数组。`);
    }
    if (raw.length === 0) {
        throw new Error(`${fieldName} 至少需要一个字符串；删除规则使用空字符串。`);
    }
    return [...raw];
}

function readOptionalStringRecord(value: Record<string, unknown>, key: string, fieldName: string): Record<string, string> | undefined {
    const raw = value[key];
    if (raw === undefined) {
        return undefined;
    }
    if (!isObject(raw)) {
        throw new Error(`${fieldName} 必须是对象。`);
    }
    const result: Record<string, string> = {};
    for (const [recordKey, recordValue] of Object.entries(raw)) {
        if (typeof recordValue !== "string" || recordValue.trim().length === 0) {
            throw new Error(`${fieldName}.${recordKey} 必须是非空字符串。`);
        }
        result[recordKey] = recordValue.trim();
    }
    return result;
}

function readRuleLevel(value: unknown, fieldName: string): RuleLevel {
    if (value !== "high" && value !== "medium" && value !== "low") {
        throw new Error(`${fieldName} 必须是 high、medium 或 low。`);
    }
    return value;
}

function readOptionalReview(value: Record<string, unknown>, key: string, fieldName: string): Review | undefined {
    const raw = value[key];
    if (raw === undefined) {
        return undefined;
    }
    if (raw !== "agent" && raw !== "human" && raw !== "none") {
        throw new Error(`${fieldName} 必须是 agent、human 或 none。`);
    }
    return raw;
}

function readOptionalFixability(value: Record<string, unknown>, key: string, fieldName: string): Fixability | undefined {
    const raw = value[key];
    if (raw === undefined) {
        return undefined;
    }
    if (raw !== "auto" && raw !== "candidate" && raw !== "manual") {
        throw new Error(`${fieldName} 必须是 auto、candidate 或 manual。`);
    }
    return raw;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) {
            result[key] = item;
        }
    }
    return result as T;
}

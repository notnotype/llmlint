import {existsSync} from "node:fs";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import type {Fixability, LlmlintConfig, LlmlintOutput, NormalizedLlmlintConfig, NormalizedRuleOverride, Review, RuleLevel, RuleOverride, RulesetOverride} from "./types";

const DEFAULT_CONFIG: NormalizedLlmlintConfig = {
    rulesets: ["builtin/default"],
    trustedRulesets: [],
    rulesetOverrides: {},
    namespaces: {},
    rules: {},
    output: "stylish",
};

const VALID_LEVELS = new Set<RuleLevel>(["high", "medium", "low"]);
const VALID_REVIEWS = new Set<Review>(["agent", "human", "none"]);
const VALID_FIXABILITIES = new Set<Fixability>(["auto", "candidate", "manual"]);
const VALID_RULESET_OVERRIDES = new Set<RulesetOverride>(["off", "on"]);
const VALID_OUTPUTS = new Set<LlmlintOutput>(["stylish", "json"]);

export type LoadedConfig = {
    config: NormalizedLlmlintConfig;
    configPath: string | null;
};

/**
 * 加载 llmlint 配置。显式 --config 缺失时报错；未显式配置时使用默认 ruleset。
 */
export async function loadConfig(options: {cwd: string; configPath?: string}): Promise<LoadedConfig> {
    const explicitPath = options.configPath?.trim();
    const configPath = explicitPath
        ? resolve(options.cwd, explicitPath)
        : findConfigPath(options.cwd);

    if (!configPath) {
        return {config: cloneDefaultConfig(), configPath: null};
    }

    if (!existsSync(configPath)) {
        throw new Error(`配置文件不存在: ${configPath}`);
    }

    const imported = await import(pathToFileURL(configPath).href);
    const rawConfig = imported.default ?? imported.config;
    if (!isConfigObject(rawConfig)) {
        throw new Error(`配置文件必须 default export 一个对象: ${configPath}`);
    }

    return {
        config: normalizeConfig(rawConfig),
        configPath,
    };
}

function findConfigPath(cwd: string): string | null {
    let current = resolve(cwd);
    while (true) {
        const candidate = join(current, "llmlint.config.ts");
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = dirname(current);
        if (parent === current || !isAbsolute(parent)) {
            return null;
        }
        current = parent;
    }
}

function normalizeConfig(config: LlmlintConfig): NormalizedLlmlintConfig {
    return {
        rulesets: normalizeStringArray(config.rulesets, DEFAULT_CONFIG.rulesets, "rulesets"),
        trustedRulesets: normalizeStringArray(config.trustedRulesets, DEFAULT_CONFIG.trustedRulesets, "trustedRulesets"),
        rulesetOverrides: normalizeRulesetOverrides(config.rulesetOverrides),
        namespaces: normalizeRuleOverrides(config.namespaces, "namespaces"),
        rules: normalizeRuleOverrides(config.rules, "rules"),
        output: normalizeOutput(config.output),
    };
}

function cloneDefaultConfig(): NormalizedLlmlintConfig {
    return {
        rulesets: [...DEFAULT_CONFIG.rulesets],
        trustedRulesets: [],
        rulesetOverrides: {},
        namespaces: {},
        rules: {},
        output: DEFAULT_CONFIG.output,
    };
}

function normalizeRulesetOverrides(value: LlmlintConfig["rulesetOverrides"]): Record<string, RulesetOverride> {
    if (value === undefined) {
        return {};
    }
    if (!isConfigObject(value)) {
        throw new Error("配置 rulesetOverrides 必须是对象。");
    }

    const normalized: Record<string, RulesetOverride> = {};
    for (const [rulesetId, override] of Object.entries(value)) {
        if (!VALID_RULESET_OVERRIDES.has(override as RulesetOverride)) {
            throw new Error(`规则包 ${rulesetId} 的覆盖值无效: ${String(override)}`);
        }
        normalized[rulesetId] = override as RulesetOverride;
    }
    return normalized;
}

function normalizeRuleOverrides(value: Record<string, RuleOverride> | undefined, fieldName: string): Record<string, NormalizedRuleOverride> {
    if (value === undefined) {
        return {};
    }
    if (!isConfigObject(value)) {
        throw new Error(`配置 ${fieldName} 必须是对象。`);
    }

    const normalized: Record<string, NormalizedRuleOverride> = {};
    for (const [key, override] of Object.entries(value)) {
        normalized[key] = normalizeOverrideValue(override, `${fieldName} ${key}`);
    }
    return normalized;
}

/**
 * 覆盖项归一为单一 patch 形态：字符串简写是语法糖，对象是显式 patch。
 * 这里是字符串→patch 的唯一去糖点，loader 不再二次解释字符串，避免两处语义跑偏。
 */
function normalizeOverrideValue(override: unknown, fieldName: string): NormalizedRuleOverride {
    if (typeof override === "string") {
        return expandStringOverride(override, fieldName);
    }
    if (isConfigObject(override)) {
        return normalizeOverrideObject(override, fieldName);
    }
    throw new Error(`${fieldName} 的覆盖值必须是字符串或对象: ${String(override)}`);
}

/** 字符串简写展开为 patch：off=禁用，warn/error/level=启用并设级别（保留历史「设级别即启用」语义）。 */
function expandStringOverride(override: string, fieldName: string): NormalizedRuleOverride {
    if (override === "off") {
        return {enabled: false};
    }
    if (override === "warn") {
        return {enabled: true, level: "medium"};
    }
    if (override === "error") {
        return {enabled: true, level: "high"};
    }
    if (VALID_LEVELS.has(override as RuleLevel)) {
        return {enabled: true, level: override as RuleLevel};
    }
    throw new Error(`${fieldName} 的覆盖值无效: ${override}`);
}

function normalizeOverrideObject(value: Record<string, unknown>, fieldName: string): NormalizedRuleOverride {
    const result: NormalizedRuleOverride = {};
    for (const key of Object.keys(value)) {
        if (key !== "enabled" && key !== "level" && key !== "review" && key !== "fixability") {
            throw new Error(`${fieldName}.${key} 不是允许的覆盖字段。`);
        }
    }
    if (value.enabled !== undefined) {
        if (typeof value.enabled !== "boolean") {
            throw new Error(`${fieldName}.enabled 必须是布尔值。`);
        }
        result.enabled = value.enabled;
    }
    if (value.level !== undefined) {
        if (!VALID_LEVELS.has(value.level as RuleLevel)) {
            throw new Error(`${fieldName}.level 无效: ${String(value.level)}`);
        }
        result.level = value.level as RuleLevel;
    }
    if (value.review !== undefined) {
        if (!VALID_REVIEWS.has(value.review as Review)) {
            throw new Error(`${fieldName}.review 无效: ${String(value.review)}`);
        }
        result.review = value.review as Review;
    }
    if (value.fixability !== undefined) {
        if (!VALID_FIXABILITIES.has(value.fixability as Fixability)) {
            throw new Error(`${fieldName}.fixability 无效: ${String(value.fixability)}`);
        }
        result.fixability = value.fixability as Fixability;
    }
    if (result.enabled === undefined && result.level === undefined && result.review === undefined && result.fixability === undefined) {
        throw new Error(`${fieldName} 覆盖对象至少要设置 enabled、level、review 或 fixability 之一。`);
    }
    return result;
}

function normalizeStringArray(value: string[] | undefined, fallback: string[], fieldName: string): string[] {
    if (value === undefined) {
        return [...fallback];
    }
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
        throw new Error(`配置 ${fieldName} 必须是非空字符串数组。`);
    }
    return value.map((item) => item.trim());
}

function normalizeOutput(output: LlmlintConfig["output"]): LlmlintOutput {
    if (output === undefined) {
        return DEFAULT_CONFIG.output;
    }
    if (!VALID_OUTPUTS.has(output)) {
        throw new Error(`配置 output 无效: ${String(output)}`);
    }
    return output;
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

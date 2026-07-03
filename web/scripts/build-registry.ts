// 预烘脚本：在 Node/Bun 侧跑一次 loadRules（读文件系统里 ~340 条规则 JSON），
// 把浏览器需要的静态数据序列化成 app/data/registry.json。
// 浏览器不读文件系统、不跑 loadRules，只 import 这份产物 + 调纯函数 scanText。
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {materializeRules} from "../../skill/src/rule-registry";
import {loadRuleCatalog} from "../../skill/src/rules";
import {LLMLINT_VERSION} from "../../skill/src/version";
import type {NormalizedLlmlintConfig} from "../../skill/src/types";

// 与 skill/src/config.ts 的 DEFAULT_CONFIG 一致：无配置时的默认 ruleset。
const DEFAULT_CONFIG: NormalizedLlmlintConfig = {
    rulesets: ["builtin/default"],
    trustedRulesets: [],
    rulesetOverrides: {},
    namespaces: {},
    rules: {},
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

// 只序列化浏览器需要的：扫描用的 regexRules（含全部元数据）、只读展示用的 llmRules、
// 统计 summary、加载 diagnostics。version 供页脚展示。
const registry = {
    version: LLMLINT_VERSION,
    generatedFrom: "builtin/default",
    catalog: source.catalog,
    namespaceAliases: source.namespaceAliases,
    loadedRulesets: source.loadedRulesets,
    summary: loaded.summary,
    diagnostics: loaded.diagnostics,
    regexRules: loaded.regexRules,
    llmRules: loaded.llmRules,
};

mkdirSync(dirname(outPath), {recursive: true});
writeFileSync(outPath, JSON.stringify(registry), "utf-8");

console.log(
    `registry.json 已生成：${loaded.regexRules.length} 条 regex 规则、` +
        `${loaded.llmRules.length} 条 llm 规则、${loaded.summary.activeRules}/${loaded.summary.totalRules} active。`,
);

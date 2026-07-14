#!/usr/bin/env bun
// 采集线 A repair（M4 的 repair 部分）：对已有 render 做「本地评测 → LLM 一轮润色」，产出 repair 样本。
// 流程参照线 B 五步但一轮即止（METHODOLOGY §2.3）：render → lib/scan 同口径扫描 → 问题清单 → 修复模型润色 → repair-<idx>-<slug>.md。
// 纪律：repair 单独统计、绝不进 lift/AUC（I5/D1）；prompt 版本化（I8）；断点续跑（repair 文件已存在即跳过）；单篇失败只跳该篇。
// 命名契约：repair 文件名 = 源 render 文件名把 `render-` 前缀换成 `repair-`（idx 与源 render 模型 slug 原样保留）。
// 用法：bun evals/generator/repair.ts [--corpus <dir>] [--genre <g>] [--plot <p>] [--model <render模型>] [--limit N] [--repair-model <key>]
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {isAbsolute, join} from "node:path";
import {Command} from "commander";
import {loadConfig, resolveModel, type RawConfig} from "./config";
import {loadEvalConfig, type CliProviderConfig} from "./eval-config";
import {resolveCliModel} from "./cli-transport";
import {callModelDetailed, configureModelClient, smokeCheck, type AnyModel} from "./model-client";
import {ProviderGate} from "./rate-limit";
import {repairPrompt, DEFAULT_PROMPT_VERSIONS} from "./prompts";
import {collectRepairFindings, buildRepairUser} from "./repair-prompt";
import {BudgetTracker, estimateRenderTokens, loadCalibration} from "./budget";
import {loadEvalRules} from "../lib/scan";
import {scanText} from "../../skill/src/scanner";

type SampleMeta = {file: string; role: string; model?: string; pairRef?: string; repairOf?: string; charCount?: number; promptVersion?: {repair?: string}; [key: string]: unknown};
type GroupMeta = {genre?: string; plotId?: string; samples?: SampleMeta[]; [key: string]: unknown};
type Group = {dir: string; genre: string; plot: string};

const DEFAULT_CORPUS = join(import.meta.dir, "..", "corpus");
// llmlint 仓根（generator 的上两级）：相对路径的 modelsConfig 按它解析，cwd 无关（I10）。
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** 相对路径按 llmlint 仓根解析（跨仓引用 NeuroBook config.json 时 cwd 无关）。 */
function resolveRepoPath(path: string): string {
    return isAbsolute(path) ? path : join(REPO_ROOT, path);
}

/** modelKey → HTTP 或 CLI 通道（providerId 命中 cliProviders 走 CLI）。与 generate.ts 同规则：proxy 注入 CLI 子进程；providerTimeouts 覆盖 HTTP 墙钟。 */
function resolveAnyModel(config: RawConfig, modelKey: string, cliProviders: Record<string, CliProviderConfig>, proxy?: string, providerTimeouts?: Record<string, number>): AnyModel {
    const slash = modelKey.indexOf("/");
    const providerId = slash > 0 ? modelKey.slice(0, slash) : "";
    const cli = cliProviders[providerId];
    if (cli) {
        return resolveCliModel(providerId, modelKey.slice(slash + 1), cli, proxy);
    }
    const resolved = resolveModel(config, modelKey);
    const override = providerTimeouts?.[providerId];
    return override ? {...resolved, timeoutMs: override} : resolved;
}

type Options = {
    corpus: string;
    genre?: string;
    plot?: string;
    model?: string;
    limit?: string;
    repairModel?: string;
    config: string;
    evalConfig?: string;
    check?: boolean;
};

async function run(opts: Options): Promise<void> {
    const evalConfig = loadEvalConfig(opts.evalConfig);
    const config = loadConfig(resolveRepoPath(opts.config || evalConfig.modelsConfig));
    // proxy：设进程 env → Bun fetch（HTTP 模型）+ spawn 子进程（CLI 模型）都走代理。
    if (evalConfig.proxy) {
        process.env.HTTP_PROXY = evalConfig.proxy;
        process.env.HTTPS_PROXY = evalConfig.proxy;
        process.env.http_proxy = evalConfig.proxy;
        process.env.https_proxy = evalConfig.proxy;
    }
    configureModelClient({
        retry: evalConfig.retry,
        gate: new ProviderGate(evalConfig.rateLimit.default, evalConfig.rateLimit.perProvider ?? {}),
    });

    const modelKey = opts.repairModel || evalConfig.repair?.model;
    if (!modelKey) {
        fail("未配置修复模型：--repair-model 或 eval.config 的 repair.model");
    }
    const model = resolveAnyModel(config, modelKey, evalConfig.cliProviders ?? {}, evalConfig.proxy, evalConfig.providerTimeouts);
    const promptVersion = evalConfig.repair?.promptVersion || DEFAULT_PROMPT_VERSIONS.repair;
    const preset = repairPrompt(promptVersion); // 未知版本直接抛（I8：宁失败不静默换 prompt）

    if (opts.check) {
        try {
            const {text, latencyMs} = await smokeCheck(model);
            console.log(`✓ ${model.modelKey}  ${latencyMs}ms  ${JSON.stringify(text)}`);
        } catch (error) {
            console.log(`✗ ${model.modelKey}  ${errMsg(error)}`);
        }
        return;
    }

    // 同口径本地扫描：与 score.ts 共用 lib/scan 的规则加载（builtin/default 全量，import 引擎不 spawn CLI，I9）。
    const {regexRules} = await loadEvalRules();

    const groups = findGroups(opts.corpus).filter((group) => (!opts.genre || group.genre === opts.genre) && (!opts.plot || group.plot === opts.plot));
    if (groups.length === 0) {
        fail(`语料里没有匹配的题组：${opts.corpus}${opts.genre ? `（genre=${opts.genre}）` : ""}${opts.plot ? `（plot=${opts.plot}）` : ""}`);
    }
    const limit = opts.limit ? Number.parseInt(opts.limit, 10) : Number.POSITIVE_INFINITY;

    console.log(`题组 ${groups.length}｜修复模型 ${model.modelKey}｜prompt ${promptVersion}${opts.model ? `｜只修 ${opts.model} 的 render` : ""}｜断点续跑：repair 文件已存在即跳过`);
    const budget = new BudgetTracker();
    const cal = loadCalibration();
    let produced = 0;   // 本轮新生成
    let reused = 0;     // 文件已存在，跳过（仅重登 meta）
    let clean = 0;      // 无 agent 桶命中，无可修复问题
    let failed = 0;     // 调用失败 / 拒答守门丢弃
    let attempted = 0;  // 尝试生成数（受 --limit 约束；已存在跳过不计）

    for (const group of groups) {
        const meta = readMeta(group.dir);
        const renders = (meta.samples ?? []).filter((sample) => sample.role === "render" && (!opts.model || sample.model === opts.model));
        if (renders.length === 0) {
            continue;
        }
        // 本轮登记的 repair meta 条目（含"文件已存在"的重登，保 meta 与文件一致）。
        const entries: SampleMeta[] = [];
        for (const render of renders) {
            if (!render.file.startsWith("render-")) {
                console.log(`  ⚠ ${group.genre}/${group.plot} ${render.file}：非标准 render 命名，无法派生 repair 文件名，跳过`);
                continue;
            }
            const repairFile = render.file.replace(/^render-/u, "repair-");
            const repairPath = join(group.dir, repairFile);
            if (existsSync(repairPath)) {
                entries.push(repairEntry(repairFile, model.modelKey, render, visibleLength(readFileSync(repairPath, "utf-8")), promptVersion));
                reused += 1;
                continue;
            }
            if (attempted >= limit) {
                continue; // 达到 --limit：不再生成，但后续已存在文件仍会重登 meta
            }
            const renderPath = join(group.dir, render.file);
            if (!existsSync(renderPath)) {
                console.log(`  ⚠ ${group.genre}/${group.plot} ${render.file}：源 render 文件不存在，跳过`);
                continue;
            }
            const renderText = readFileSync(renderPath, "utf-8");
            const originalChars = visibleLength(renderText);
            // 问题清单：agent 桶命中按规则聚合（规则标题 + 去重引文，三层封顶控 prompt 长度）。
            const findings = collectRepairFindings(scanText(renderText, regexRules, {}));
            if (findings.length === 0) {
                console.log(`  · ${group.genre}/${group.plot} ${render.file}：无 agent 桶命中，无可修复问题，跳过`);
                clean += 1;
                continue;
            }
            attempted += 1;
            const user = buildRepairUser(renderText, findings);
            let text: string;
            try {
                const est = estimateRenderTokens(visibleLength(user), originalChars, cal.charsPerToken);
                budget.addEstimate(model.modelKey, est.input, est.output);
                // maxTokens 16000：与 render 同参——整章正文输出 + 给推理模型留思考余量。
                const result = await callModelDetailed(model, preset.system, user, 16000);
                text = result.text.trim();
                budget.addActual(model.modelKey, result.usage, {input: Math.round(visibleLength(user) / 1.5), output: Math.round(visibleLength(text) / 1.5)});
            } catch (error) {
                console.log(`  ⚠ ${group.genre}/${group.plot} ${render.file} ← ${model.modelKey}：${errMsg(error)}，跳过`);
                failed += 1;
                continue;
            }
            // 拒答/截断守门：修复本远短于原文（< min(400, 原文×0.5)）判失败丢弃——伪 repair 入库会污染 before/after 统计。
            if (visibleLength(text) < Math.min(400, originalChars * 0.5)) {
                console.log(`  ⚠ ${group.genre}/${group.plot} ${render.file} ← ${model.modelKey}：疑似拒答/截断（${visibleLength(text)} 字 ≪ 原文 ${originalChars}），丢弃`);
                failed += 1;
                continue;
            }
            writeFileSync(repairPath, `${text}\n`, "utf-8");
            entries.push(repairEntry(repairFile, model.modelKey, render, visibleLength(text), promptVersion));
            produced += 1;
            console.log(`  ${group.genre}/${group.plot} ${render.file} → ${repairFile}：${visibleLength(text)} 字（原 ${originalChars}）｜问题 ${findings.length} 类`);
        }
        // merge meta：按文件名替换本轮登记的 repair 条目，保留 reference/render/其它 repair。
        if (entries.length > 0) {
            const files = new Set(entries.map((entry) => entry.file));
            const kept = (meta.samples ?? []).filter((sample) => !(sample.role === "repair" && files.has(sample.file)));
            writeMeta(group.dir, {...meta, samples: [...kept, ...entries]});
        }
    }

    printActualBudget(budget);
    console.log(`完成：新生成 ${produced}｜已存在复用 ${reused}｜无命中跳过 ${clean}｜失败 ${failed}。跑 score.ts 看 report.repair（before/after 配对），跑 detector/detect.ts 补外部 P(AI)。`);
}

/** repair 的 meta 样本条目：model=修复模型、pairRef 沿源 render、repairOf=源 render 文件名（配对键）、样本级 promptVersion 记 repair 版本（I8）。 */
function repairEntry(file: string, repairModelKey: string, source: SampleMeta, charCount: number, promptVersion: string): SampleMeta {
    return {file, role: "repair", model: repairModelKey, pairRef: source.pairRef, repairOf: source.file, charCount, promptVersion: {repair: promptVersion}};
}

function printActualBudget(budget: BudgetTracker): void {
    const {rows, total} = budget.actualReport();
    if (rows.length === 0) {
        return;
    }
    console.log("实际用量：");
    for (const row of rows) {
        const tag = row.estimated > 0 ? `（${row.estimated} 篇无 usage，估算）` : "";
        console.log(`  ${row.modelKey}：${row.count} 篇｜in ${fmtK(row.input)} + out ${fmtK(row.output)} = ${fmtK(row.total)} token${tag}`);
    }
    console.log(`  合计 ${fmtK(total)} token`);
}

function findGroups(corpusRoot: string): Group[] {
    const groups: Group[] = [];
    for (const genre of listDirs(corpusRoot)) {
        for (const plot of listDirs(join(corpusRoot, genre))) {
            const dir = join(corpusRoot, genre, plot);
            if (existsSync(join(dir, "meta.json"))) {
                groups.push({dir, genre, plot});
            }
        }
    }
    return groups;
}

function readMeta(dir: string): GroupMeta {
    try {
        return JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8")) as GroupMeta;
    } catch {
        return {};
    }
}

function writeMeta(dir: string, meta: GroupMeta): void {
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

function listDirs(root: string): string[] {
    if (!existsSync(root)) {
        return [];
    }
    return readdirSync(root, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

/** 可见字数：去空白后的码点数（与 lib/corpus 口径一致）。 */
function visibleLength(text: string): number {
    return [...text.replace(/\s/gu, "")].length;
}

function errMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** token 数简写（12345 → 12.3k）。 */
function fmtK(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fail(message: string): never {
    console.error(`错误：${message}`);
    process.exit(1);
}

const program = new Command();
program
    .name("repair")
    .description("采集线 A repair：render → 本地扫描问题清单 → LLM 一轮润色 → repair 样本（I5 单独统计，不进 lift）")
    .option("--corpus <dir>", "语料根目录", DEFAULT_CORPUS)
    .option("--genre <genre>", "只处理该题材（目录名）")
    .option("--plot <plotId>", "只处理该题组（目录名）")
    .option("--model <key>", "只修复该模型生成的 render（provider/model）")
    .option("--limit <n>", "本轮最多尝试生成的篇数（已存在跳过不计）")
    .option("--repair-model <key>", "修复模型（缺省用 eval.config.repair.model）")
    .option("--config <path>", "LLM HTTP config.json 路径（缺省用 eval.config.modelsConfig）", "")
    .option("--eval-config <path>", "eval 配置路径（缺省 eval.config.json > example）")
    .option("--check", "只做修复模型连通 smoke")
    .action((opts: Options) => run(opts));

await program.parseAsync(process.argv);

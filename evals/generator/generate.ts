#!/usr/bin/env bun
// 生成侧编排：遍历题组每个 reference → 逐章各抽 brief → 各模型各 render(1:1 配对) → 写盘 + merge meta。
// commander CLI；HTTP + CLI 两种 transport；render prompt 版本写进每个 sample（守 I8）；token 预算预估/实报/自校准。
import {existsSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {Command} from "commander";
import {loadConfig, modelSlug, resolveProvider} from "./config";
import {loadEvalConfig, type EvalConfig} from "./eval-config";
import {resolveAnyModel, resolveRepoPath} from "./resolve-model";
import {configureModelClient, discoverModels, smokeCheck, type AnyModel} from "./model-client";
import {ProviderGate} from "./rate-limit";
import {extractBriefDetailed} from "./brief";
import {renderDetailed} from "./render";
import {DEFAULT_PROMPT_VERSIONS} from "./prompts";
import {BudgetTracker, estimateRenderTokens, loadCalibration, calibrate} from "./budget";

type SampleMeta = {file: string; role: string; model?: string; difficulty?: string; promptVersion?: string; pairRef?: string; charCount?: number; [key: string]: unknown};
type GroupMeta = {genre?: string; plotId?: string; promptVersion?: {brief?: string; render?: string}; samples?: SampleMeta[]; [key: string]: unknown};
type Group = {dir: string; genre: string; plot: string};

const DEFAULT_CORPUS = join(import.meta.dir, "..", "corpus");

type Options = {
    corpus: string;
    models?: string;
    extractor?: string;
    maxGroups: string;
    check?: boolean;
    listModels?: string;
    config: string;
    evalConfig?: string;
    estimate?: boolean;
    promptBrief?: string;
    promptRender?: string;
};

async function run(opts: Options): Promise<void> {
    const evalConfig = loadEvalConfig(opts.evalConfig);
    const config = loadConfig(resolveRepoPath(opts.config || evalConfig.modelsConfig));
    const cliProviders = evalConfig.cliProviders ?? {};
    // proxy：设进程 env → Bun fetch（pi-ai HTTP 调用）+ spawn 子进程（CLI）都走代理（所有 provider 支持 http proxy）。
    if (evalConfig.proxy) {
        process.env.HTTP_PROXY = evalConfig.proxy;
        process.env.HTTPS_PROXY = evalConfig.proxy;
        process.env.http_proxy = evalConfig.proxy;
        process.env.https_proxy = evalConfig.proxy;
    }

    // 可靠性配置：重试参数 + per-provider 限流，注入 model-client。
    configureModelClient({
        retry: evalConfig.retry,
        gate: new ProviderGate(evalConfig.rateLimit.default, evalConfig.rateLimit.perProvider ?? {}),
    });

    // 模型发现：列出某 provider 当前可用 model id（config.json 会过时）。
    if (opts.listModels) {
        const ids = await discoverModels(resolveProvider(config, opts.listModels));
        console.log(`${opts.listModels} 可用模型（${ids.length}）：`);
        ids.forEach((id) => console.log(`  ${opts.listModels}/${id}`));
        return;
    }

    const modelKeys = opts.models ? opts.models.split(",").map((k) => k.trim()).filter(Boolean) : evalConfig.renderModels;
    const models = modelKeys.map((key) => resolveAnyModel(config, key, cliProviders, evalConfig.proxy, evalConfig.providerTimeouts));
    const extractor = resolveAnyModel(config, opts.extractor || evalConfig.extractor, cliProviders, evalConfig.proxy, evalConfig.providerTimeouts);
    const promptVersions = {
        brief: opts.promptBrief || evalConfig.prompts.brief || DEFAULT_PROMPT_VERSIONS.brief,
        render: opts.promptRender || evalConfig.prompts.render || DEFAULT_PROMPT_VERSIONS.render,
    };

    if (opts.check) {
        for (const model of dedupeModels([extractor, ...models])) {
            try {
                const {text, latencyMs} = await smokeCheck(model);
                console.log(`✓ ${model.modelKey}  ${latencyMs}ms  ${JSON.stringify(text)}`);
            } catch (error) {
                console.log(`✗ ${model.modelKey}  ${errMsg(error)}`);
            }
        }
        return;
    }

    const groups = findGroups(opts.corpus).slice(0, Number.parseInt(opts.maxGroups, 10));
    if (groups.length === 0) {
        fail(`语料里没有题组：${opts.corpus}`);
    }

    if (opts.estimate) {
        estimateRun(groups, models, promptVersions);
        return;
    }

    // 断点续跑前全局预检，避免跑到一半才发现旧文件版本未知，产生新的昂贵半成品。
    for (const group of groups) {
        const meta = readMeta(group.dir);
        const references = (meta.samples ?? []).filter((sample) => sample.role === "reference");
        const samplesByFile = new Map((meta.samples ?? []).map((sample) => [sample.file, sample]));
        for (let position = 0; position < references.length; position += 1) {
            const ref = references[position]!;
            const idx = refIndex(ref.file, position);
            for (const model of models) {
                const file = `render-${idx}-${modelSlug(model.modelKey)}.md`;
                if (!existsSync(join(group.dir, file))) {
                    continue;
                }
                const existing = samplesByFile.get(file);
                if (typeof existing?.promptVersion !== "string" || existing.promptVersion.trim().length === 0) {
                    throw new Error(`${group.genre}/${group.plot}/${file} 已存在但缺样本级 promptVersion；不能把旧 render 冒充 ${promptVersions.render} 续跑，请确认版本后补录或删除文件重生成。`);
                }
                if (existing.promptVersion !== promptVersions.render) {
                    throw new Error(`${group.genre}/${group.plot}/${file} 使用 ${existing.promptVersion}，本轮请求 ${promptVersions.render}；跨版本不能复用同一 render。`);
                }
            }
        }
    }

    console.log(`题组 ${groups.length}｜抽取器 ${extractor.modelKey}｜render 模型 ${models.map((m) => m.modelKey).join(", ")}｜prompt ${promptVersions.brief}/${promptVersions.render}｜逐章 1:1 配对`);
    const budget = new BudgetTracker();
    const cal = loadCalibration();

    for (const group of groups) {
        const meta = readMeta(group.dir);
        const references = (meta.samples ?? []).filter((sample) => sample.role === "reference");
        if (references.length === 0) {
            console.log(`- 跳过 ${group.genre}/${group.plot}：无 reference`);
            continue;
        }
        // 作废旧命名 render（无章号），逐章 idx'd render 保留以支持断点续跑。
        rmIfExists(join(group.dir, "brief.md"));
        for (const model of models) {
            rmIfExists(join(group.dir, `render-${modelSlug(model.modelKey)}.md`));
        }

        const newRenders: SampleMeta[] = [];
        for (let position = 0; position < references.length; position += 1) {
            const ref = references[position]!;
            const idx = refIndex(ref.file, position);
            const referenceText = readFileSync(join(group.dir, ref.file), "utf-8");
            const targetChars = visibleLength(referenceText);

            const briefPath = join(group.dir, `brief-${idx}.md`);
            let brief: string;
            if (existsSync(briefPath)) {
                brief = readFileSync(briefPath, "utf-8");
            } else {
                try {
                    const result = await extractBriefDetailed(referenceText, extractor, promptVersions.brief);
                    brief = result.text;
                    budget.addActual(extractor.modelKey, result.usage, {input: Math.round(visibleLength(referenceText) / 1.5), output: Math.round(visibleLength(result.text) / 1.5)});
                } catch (error) {
                    console.log(`  ⚠ ${group.genre}/${group.plot} ${ref.file}：brief-${idx} 抽取失败（${errMsg(error)}），跳过本章`);
                    continue;
                }
                writeFileSync(briefPath, `${brief.trim()}\n`, "utf-8");
                console.log(`  ${group.genre}/${group.plot} ${ref.file}：brief-${idx}（${visibleLength(brief)} 字）`);
            }

            for (const model of models) {
                const file = `render-${idx}-${modelSlug(model.modelKey)}.md`;
                const renderPath = join(group.dir, file);
                if (existsSync(renderPath)) {
                    const existing = (meta.samples ?? []).find((sample) => sample.file === file)!;
                    newRenders.push({...existing, file, role: "render", model: model.modelKey, difficulty: existing.difficulty ?? "raw", promptVersion: existing.promptVersion, pairRef: ref.file, charCount: visibleLength(readFileSync(renderPath, "utf-8"))});
                    continue;
                }
                let text: string;
                try {
                    // 记这一篇的预估（真跑口径），供末尾 est vs actual 自校准。
                    const est = estimateRenderTokens(visibleLength(brief), targetChars, cal.charsPerToken);
                    budget.addEstimate(model.modelKey, est.input, est.output);
                    const result = await renderDetailed(brief, {genre: group.genre, targetChars}, model, promptVersions.render);
                    text = result.text.trim();
                    budget.addActual(model.modelKey, result.usage, {input: Math.round(visibleLength(brief) / 1.5), output: Math.round(visibleLength(text) / 1.5)});
                } catch (error) {
                    console.log(`  ⚠ ${group.genre}/${group.plot} ${ref.file} ← ${model.modelKey}：${errMsg(error)}，跳过`);
                    continue;
                }
                if (visibleLength(text) === 0) {
                    console.log(`  ⚠ ${group.genre}/${group.plot} ${ref.file} ← ${model.modelKey}：空输出，跳过`);
                    continue;
                }
                // 拒答/截断守门：render 远短于目标（<20% 且 <400 字）多半是安全拒答或补全截断（如 gemini 偶发
                // "我必须绕过该话题…"）。这类"伪 render"若入库会污染 lift/检测器，宁跳勿留。
                if (visibleLength(text) < Math.min(400, targetChars * 0.2)) {
                    console.log(`  ⚠ ${group.genre}/${group.plot} ${ref.file} ← ${model.modelKey}：疑似拒答/截断（${visibleLength(text)} 字 ≪ ref ${targetChars}），跳过`);
                    continue;
                }
                writeFileSync(renderPath, `${text}\n`, "utf-8");
                newRenders.push({file, role: "render", model: model.modelKey, difficulty: "raw", promptVersion: promptVersions.render, pairRef: ref.file, charCount: visibleLength(text)});
                console.log(`  ${group.genre}/${group.plot} ${ref.file} ← ${model.modelKey}：${visibleLength(text)} 字（ref ${targetChars}）`);
            }
        }

        // merge meta：每个 render 自带版本；题组级版本只保留 brief/本轮生成上下文，不作为报告校验来源。
        const renderModelKeys = new Set(models.map((model) => model.modelKey));
        const kept = (meta.samples ?? []).filter((sample) => !(sample.role === "render" && renderModelKeys.has(String(sample.model))));
        writeMeta(group.dir, {...meta, promptVersion: promptVersions, samples: [...kept, ...newRenders]});
    }

    printActualBudget(budget);
    console.log("完成。跑 score.ts 看真实 lift（逐章 1:1）。");
}

/** --estimate：干跑，按 brief（已存在则实读，否则估）+ targetChars 折算 token，分模型汇总。 */
function estimateRun(groups: Group[], models: AnyModel[], promptVersions: {brief: string; render: string}): void {
    const cal = loadCalibration();
    const budget = new BudgetTracker();
    let renders = 0;
    for (const group of groups) {
        const references = (readMeta(group.dir).samples ?? []).filter((s) => s.role === "reference");
        for (let position = 0; position < references.length; position += 1) {
            const ref = references[position]!;
            const idx = refIndex(ref.file, position);
            const targetChars = ref.charCount ?? visibleLength(readFileSync(join(group.dir, ref.file), "utf-8"));
            const briefPath = join(group.dir, `brief-${idx}.md`);
            // brief 已抽出用实际字数，否则按目标字数 0.5 估（剧情纲是压缩摘要）。
            const briefChars = existsSync(briefPath) ? visibleLength(readFileSync(briefPath, "utf-8")) : Math.round(targetChars * 0.5);
            for (const model of models) {
                if (existsSync(join(group.dir, `render-${idx}-${modelSlug(model.modelKey)}.md`))) {
                    continue; // 断点续跑：已有的不重复算
                }
                const est = estimateRenderTokens(briefChars, targetChars, cal.charsPerToken);
                budget.addEstimate(model.modelKey, est.input, est.output);
                renders += 1;
            }
        }
    }
    const {rows, total} = budget.estimateReport();
    console.log(`预估：待生成 ${renders} 篇 render｜prompt ${promptVersions.brief}/${promptVersions.render}｜校准系数 ${cal.charsPerToken} 字/token（样本 ${cal.ratioSamples}）`);
    for (const row of rows) {
        console.log(`  ${row.modelKey}：${row.count} 篇｜in ${fmtK(row.input)} + out ${fmtK(row.output)} = ${fmtK(row.total)} token`);
    }
    console.log(`  合计 ≈ ${fmtK(total)} token（不含 brief 抽取；实际以真跑为准）`);
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
    // 自校准：本轮预估 output（真跑口径累加）vs 实报 output，修正 charsPerToken 写回。
    const estOut = budget.estimateReport().rows.reduce((sum, r) => sum + r.output, 0);
    const actOut = rows.reduce((sum, r) => sum + r.output, 0);
    if (estOut > 0 && actOut > 0) {
        const next = calibrate(estOut, actOut, loadCalibration());
        console.log(`  校准：预估 out ${fmtK(estOut)} vs 实报 out ${fmtK(actOut)} → 系数 ${next.charsPerToken} 字/token`);
    }
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

function dedupeModels(models: AnyModel[]): AnyModel[] {
    const seen = new Set<string>();
    return models.filter((model) => (seen.has(model.modelKey) ? false : (seen.add(model.modelKey), true)));
}

function visibleLength(text: string): number {
    return [...text.replace(/\s/gu, "")].length;
}

function rmIfExists(path: string): void {
    if (existsSync(path)) {
        rmSync(path);
    }
}

function errMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** token 数简写（12345 → 12.3k）。 */
function fmtK(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** reference 文件名里的序号（`reference-0001.md` → "0001"）；非数字命名回退位置序号。 */
function refIndex(file: string, position: number): string {
    const matched = file.match(/(\d+)\.md$/u);
    return matched ? matched[1]! : String(position + 1).padStart(4, "0");
}

function fail(message: string): never {
    console.error(`错误：${message}`);
    process.exit(1);
}

const program = new Command();
program
    .name("generate")
    .description("eval 生成侧：抽 brief + 各模型 render（1:1 配对）")
    .option("--corpus <dir>", "语料根目录", DEFAULT_CORPUS)
    .option("--models <keys>", "render 模型面板（逗号分隔 provider/model；缺省用 eval.config.renderModels）")
    .option("--extractor <key>", "brief 抽取器 modelKey（缺省用 eval.config.extractor）")
    .option("--max-groups <n>", "最多处理题组数", "50")
    .option("--check", "只做连通 smoke（含抽取器 + 各 render 模型）")
    .option("--list-models <provider>", "列出某 provider 当前可用 model id")
    .option("--config <path>", "LLM HTTP config.json 路径（缺省用 eval.config.modelsConfig）", "")
    .option("--eval-config <path>", "eval 配置路径（缺省 eval.config.json > example）")
    .option("--estimate", "只预估 token 用量，不真跑")
    .option("--prompt-brief <key>", "brief prompt 版本（守 I8）")
    .option("--prompt-render <key>", "render prompt 版本（守 I8）")
    .action((opts: Options) => run(opts));

await program.parseAsync(process.argv);

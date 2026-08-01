#!/usr/bin/env bun
// 投递方式元评测 · 生成侧：写作约束放在**哪里**才起作用？
//
// 起因：`guide-arm` 实验（约束进 system prompt，deepseek）显示注入有效，主指标 p = 0.009。
// 但把 skill 装进 ~/.claude/skills/ 用 `claude -p` 实测时，Opus 5 读了 `guide` 之后照样写出
// 「不是A，是B」——而那条就在 guide 第 42 行。两个实验有**两个变量同时不同**：
//
//   guide-arm：约束进 system prompt ＋ deepseek-v4-flash
//   skill 实测：约束进 tool result 上下文 ＋ Opus 5
//
// 所以无法判断失败该归给投递位置还是归给「强模型本来就不需要」。本实验固定模型（都用 claude
// CLI 的 Opus 5），只动投递方式，三臂：
//
//   control     不给约束
//   sysprompt   约束进 system prompt（走 --append-system-prompt-file）
//   toolresult  约束进 tool result（prompt 里要求先跑 `llmlint guide` 再动笔，还原真实 skill 路径）
//
// sysprompt 与 toolresult 两臂的约束正文必须相同：内存 guide 生成后，模型调用前还会真实执行
// toolresult 的同构 CLI 并逐字节核对 stdout。唯一差别才是约束进入上下文的位置。
//
// 三臂的写作指令一律走 --append-system-prompt-file，位置一致；user message 只放 brief
// （toolresult 臂额外前置一句取约束的指令）。这样「写作指令在哪」不构成第二个变量。
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {loadEvalConfig} from "../generator/eval-config";
import {renderPrompt, renderSystem} from "../generator/prompts";
import {visibleLength} from "../lib/corpus";
import {GUIDE_TIERS} from "../../skill/src/guide";
import {buildExperimentGuide, listGroups, readGroupMeta, refsOf, resolveTier, verifyExperimentGuide, writeGroupMeta, type SampleMeta} from "./arm-corpus";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const DEFAULT_CORPUS = join(import.meta.dir, "..", "corpus");
const DEFAULT_OUT = join(import.meta.dir, "delivery-arm-v2");
const DEFAULT_SKILL_ROOT = join(REPO_ROOT, "skill");
/** 约束正文来自 render-v2 的槽位机制，与 guide-arm 同口径（空约束时与 v1 逐字节等价）。 */
const RENDER_VERSION = "render-v2";
/** 模型标识写死：本实验的全部意义在于**固定模型**只动投递方式。 */
const MODEL_KEY = "claude-cli/claude-opus-5";

const ARMS = ["control", "sysprompt", "toolresult"] as const;
type Arm = typeof ARMS[number];

type Options = {
    corpus: string;
    out: string;
    tier: string;
    profile?: string;
    skillRoot: string;
    maxGroups: string;
    perGroup: string;
    evalConfig?: string;
    timeout: string;
    maxCalls: string;
    dryRun?: boolean;
};

async function run(opts: Options): Promise<void> {
    const tier = resolveTier(opts.tier);
    const corpusRoot = resolve(opts.corpus);
    const outRoot = resolve(opts.out);
    const skillRoot = resolve(opts.skillRoot);
    const perGroup = Number(opts.perGroup);
    const timeoutMs = Number(opts.timeout) * 1000;
    const maxCalls = Number(opts.maxCalls);
    const profilePath = opts.profile === undefined ? undefined : resolve(opts.profile);

    if (!existsSync(join(skillRoot, "bin", "llmlint.ts"))) {
        throw new Error(`skill 根不对，找不到 bin/llmlint.ts：${skillRoot}`);
    }
    const guide = await buildExperimentGuide(tier, profilePath);
    const guideText = guide.text;
    console.log(`写作约束：档位 ${tier}，${visibleLength(guideText)} 可见字`);
    console.log(`模型：${MODEL_KEY}（claude CLI）｜skill 根：${skillRoot}\n`);

    const evalConfig = loadEvalConfig(opts.evalConfig);
    const groups = listGroups(corpusRoot).slice(0, Number(opts.maxGroups));
    const plan = groups.flatMap((group) => refsOf(corpusRoot, group).slice(0, perGroup).map((ref) => ({group, ref})));
    console.log(`题组 ${groups.length} × 章节 ≤${perGroup} × 三臂 = 最多 ${plan.length * ARMS.length} 次调用`);
    console.log(`输出：${outRoot}\n`);
    if (existsSync(outRoot)) {
        verifyExperimentGuide(outRoot, guide.provenance);
    }

    // 在任何模型调用之前，用 toolresult 臂将执行的同一条 CLI 真实取一次 guide。
    // console.log 固有的单个尾换行属于 CLI 传输边界；去掉它后正文必须与 provenance 文本逐字节一致。
    const workDir = join(tmpdir(), "llmlint-delivery-arm");
    mkdirSync(workDir, {recursive: true});
    await assertGuideCliText({skillRoot, tier, profilePath, expected: guideText, workDir});
    if (opts.dryRun) {
        for (const {group, ref} of plan) {
            console.log(`  ${group.genre}/${group.plot} ${ref.file}（目标 ${ref.targetChars} 字）`);
        }
        console.log(`\n干跑结束，未调用模型。`);
        return;
    }

    // claude CLI 的 cwd 用系统临时目录：在仓内跑会让它自动发现 AGENTS.md / CLAUDE.md，
    // 把项目上下文混进写作任务。用户级 ~/.claude/CLAUDE.md 不存在（已确认），所以临时目录是干净的。
    let done = 0;
    let skipped = 0;
    let failed = 0;
    let authAborted = false;
    let budgetHit = false;
    plan_loop: for (const {group, ref} of plan) {
        const outDir = join(outRoot, group.genre, group.plot);
        mkdirSync(outDir, {recursive: true});
        const brief = readFileSync(ref.briefPath, "utf-8");
        const samples: SampleMeta[] = readGroupMeta(outDir)?.samples ?? [];

        // 三臂紧挨着跑：让服务端波动、限流抖动对三臂等量作用。
        for (const arm of ARMS) {
            const file = `render-${ref.idx}-opus5-${arm}.md`;
            const path = join(outDir, file);
            if (existsSync(path)) {
                skipped++;
                continue;
            }
            if (done + failed >= maxCalls) {
                // 本批调用配额用完，干净收尾。宿主环境会掐掉跑太久的进程，被掐时正在生成的
                // 那次调用就白花了；用配额分批跑可以每批都正常退出，缺口留给下一批补。
                budgetHit = true;
                break plan_loop;
            }
            const outcome = await renderOne({arm, brief, genre: group.genre, targetChars: ref.targetChars, guideText, tier, profilePath, skillRoot, workDir, proxy: evalConfig.proxy, timeoutMs});
            if (!outcome.ok) {
                failed++;
                if (outcome.auth) {
                    // 重试用尽仍认证失败：继续跑只会把剩下几十次调用全刷成同一个错误。
                    authAborted = true;
                    break plan_loop;
                }
                continue;
            }
            writeFileSync(path, outcome.text, "utf-8");
            samples.push({file, role: "render", model: MODEL_KEY, promptVersion: RENDER_VERSION, pairRef: ref.file, styleKey: arm, difficulty: arm === "control" ? "raw" : `${arm}-guide-${tier}`, charCount: visibleLength(outcome.text)});
            writeGroupMeta(outDir, group.genre, group.plot, RENDER_VERSION, guide.provenance, samples);
            done++;
            console.log(`  ${group.genre}/${group.plot} ${ref.file} [${arm}]：${visibleLength(outcome.text)} 字（目标 ${ref.targetChars}）`);
        }
    }
    console.log(`\n完成：新生成 ${done}，已存在跳过 ${skipped}，失败 ${failed}`);
    if (failed > 0) {
        console.log(`失败的样本不写盘；重跑本命令只补失败项。`);
    }
    if (budgetHit) {
        console.log(`本批 --max-calls ${maxCalls} 配额用完，还有缺口未补。重跑同一条命令继续（已生成的自动跳过）。`);
    }
    if (authAborted) {
        console.log(`\n✖ 已提前中止：重试 ${AUTH_RETRIES} 次后仍然认证失败。`);
        console.log(`  claude CLI 的 OAuth 凭据是进程间共享的单份文件，主会话与子进程在临近过期时会争着刷新。`);
        console.log(`  先在终端跑一次 \`claude\` 确认能登录，然后重跑本命令补齐缺口（已生成的样本自动跳过）。`);
        process.exitCode = 1;
    }
}

/**
 * 一次调用的结果。
 *
 * 之所以要把「认证失败」与其它失败分开：claude CLI 的 OAuth 凭据是**进程间共享**的单份文件，
 * 主会话与连续启动的子进程都会在临近过期时尝试刷新，一方轮换 refresh token 后另一方手里的
 * 就失效了。这类失败是暂时的（等对方刷新完就好），值得重试；而连续多次都认证失败说明真的
 * 需要人重新登录，此时应该早停而不是把剩下几十次调用全刷成失败日志。
 */
type RenderOutcome = {ok: true; text: string} | {ok: false; auth: boolean};

/** 认证失败后的重试次数与间隔。间隔给得比较长，是等另一个进程把凭据刷新完并落盘。 */
const AUTH_RETRIES = 3;
const AUTH_RETRY_MS = 30_000;

/**
 * 跑一臂，认证失败时自动重试。
 *
 * @returns `{ok:true}` 带正文；失败时 `{ok:false, auth}` 标明是不是认证问题。
 *   产出明显过短（疑似拒答/被工具流程带偏）算失败，判据沿用 guide-arm 与 generate.ts。
 */
async function renderOne(args: {arm: Arm; brief: string; genre: string; targetChars: number; guideText: string; tier: string; profilePath?: string; skillRoot: string; workDir: string; proxy?: string; timeoutMs: number}): Promise<RenderOutcome> {
    for (let attempt = 0; attempt <= AUTH_RETRIES; attempt++) {
        const outcome = await renderAttempt(args);
        if (outcome.ok || !outcome.auth || attempt === AUTH_RETRIES) {
            return outcome;
        }
        console.log(`  ↻ [${args.arm}] 认证失败，${AUTH_RETRY_MS / 1000}s 后重试（${attempt + 1}/${AUTH_RETRIES}）`);
        await Bun.sleep(AUTH_RETRY_MS);
    }
    return {ok: false, auth: true};
}

/** 单次 claude 调用，不含重试。 */
async function renderAttempt(args: {arm: Arm; brief: string; genre: string; targetChars: number; guideText: string; tier: string; profilePath?: string; skillRoot: string; workDir: string; proxy?: string; timeoutMs: number}): Promise<RenderOutcome> {
    const {arm, brief, targetChars, guideText, tier, profilePath, skillRoot, workDir, proxy, timeoutMs} = args;
    // 只有 sysprompt 臂把约束塞进 system；另两臂的 system 是空约束形态（= render-v1 逐字节等价）。
    const system = renderSystem(renderPrompt(RENDER_VERSION), targetChars, arm === "sysprompt" ? guideText : "");
    const systemFile = join(workDir, `system-${arm}.txt`);
    writeFileSync(systemFile, system, "utf-8");

    const userPrompt = arm === "toolresult"
        ? `动笔之前先做一件事：运行下面这条命令，把它输出的写作约束完整读一遍。\n\n${guideCommand(skillRoot, tier, profilePath)}\n\n读完之后直接输出这一章的正文。不要复述约束内容，不要说明你做了什么，不要写任何前言或结语。\n\n下面是这一章的剧情纲：\n\n${brief}`
        : brief;

    const argv = [Bun.which("claude") ?? "claude", "-p", userPrompt, "--append-system-prompt-file", systemFile];
    if (arm === "toolresult") {
        // 只给 Bash：这一臂必须真的去跑 CLI 拿约束，才算还原 skill 路径。
        argv.push("--allowedTools", "Bash");
    }

    try {
        const proc = Bun.spawn(argv, {
            cwd: workDir,
            env: {...process.env, ...(proxy === undefined ? {} : {HTTPS_PROXY: proxy, HTTP_PROXY: proxy})},
            stdout: "pipe",
            stderr: "pipe",
        });
        const timer = setTimeout(() => proc.kill(), timeoutMs);
        const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
        const code = await proc.exited;
        clearTimeout(timer);
        if (code !== 0) {
            const message = (err || out).slice(0, 200).replace(/\n/g, " ");
            const auth = /authenticat|OAuth|401|403/i.test(err || out);
            console.log(`  ✖ [${arm}] claude 退出码 ${code}：${message}`);
            return {ok: false, auth};
        }
        const text = stripWrapper(out);
        if (visibleLength(text) < Math.min(400, targetChars * 0.2)) {
            console.log(`  ⚠ [${arm}]：疑似拒答/截断（${visibleLength(text)} 字 ≪ 目标 ${targetChars}），跳过`);
            return {ok: false, auth: false};
        }
        return {ok: true, text};
    } catch (error) {
        console.log(`  ✖ [${arm}]：${error instanceof Error ? error.message : String(error)}`);
        return {ok: false, auth: false};
    }
}

/** toolresult 臂与 preflight 共用同一命令构造，profile 始终是已解析的绝对路径。 */
export function guideCommand(skillRoot: string, tier: string, profilePath?: string): string {
    const profile = profilePath === undefined ? "" : ` --profile "${profilePath}"`;
    return `bun "${join(skillRoot, "bin", "llmlint.ts")}" guide --tier ${tier}${profile}`;
}

/** 真实执行 guide CLI，核对退出码和去掉 CLI 固有尾换行后的正文。 */
async function assertGuideCliText(args: {skillRoot: string; tier: string; profilePath?: string; expected: string; workDir: string}): Promise<void> {
    const argv = [Bun.which("bun") ?? "bun", join(args.skillRoot, "bin", "llmlint.ts"), "guide", "--tier", args.tier];
    if (args.profilePath !== undefined) {
        argv.push("--profile", args.profilePath);
    }
    const proc = Bun.spawn(argv, {cwd: args.workDir, stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0) {
        throw new Error(`guide CLI preflight 失败（exit=${code}）：${stderr.trim() || stdout.trim()}`);
    }
    const actual = stdout.endsWith("\r\n") ? stdout.slice(0, -2) : stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
    if (Buffer.from(actual, "utf-8").compare(Buffer.from(args.expected, "utf-8")) !== 0) {
        throw new Error("guide CLI preflight 正文与 sysprompt 内存 guide 不一致，已在模型调用前中止。");
    }
}

/**
 * 去掉模型偶尔加的 markdown 代码围栏。
 *
 * render prompt 已经明确要求「不要 markdown 标记」，所以这里只做最后一道保险，不做更激进的
 * 清洗——把「疑似前言」也剪掉会掩盖 prompt 没被遵守这件事，那本身是要观察的信号。
 */
function stripWrapper(raw: string): string {
    const text = raw.trim();
    const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(text);
    return (fenced?.[1] ?? text).trim();
}

const program = new Command();
program
    .name("delivery-arm")
    .description("投递方式元评测生成侧：固定模型，只动写作约束进上下文的位置（control / sysprompt / toolresult）")
    .option("--corpus <dir>", "主语料根（只读 brief 与 reference）", DEFAULT_CORPUS)
    .option("--out <dir>", "实验语料输出根", DEFAULT_OUT)
    .option("--tier <tier>", `写作约束档位：${GUIDE_TIERS.join(" < ")}`, "standard")
    .option("--profile <path>", "eval 报告 JSON 路径；提供后 core/wide 档才带判别力规则")
    .option("--skill-root <dir>", "llmlint skill 根（toolresult 臂要跑它的 CLI）", DEFAULT_SKILL_ROOT)
    .option("--max-groups <n>", "最多处理题组数", "50")
    .option("--per-group <n>", "每个题组最多处理章节数", "1")
    .option("--eval-config <path>", "eval 配置路径（取 proxy）")
    .option("--timeout <seconds>", "单次 claude 调用超时秒数", "600")
    .option("--max-calls <n>", "本批最多发起多少次调用（配额用完干净退出，重跑续补）", "1000")
    .option("--dry-run", "只列出将要生成的样本与调用次数，不调用模型")
    .action((opts: Options) => run(opts));

await program.parseAsync(process.argv);

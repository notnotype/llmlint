// eval 配置加载：evals/eval.config.json（真实配置，gitignore，可含密钥）> eval.config.example.json（进 git 的模板）> 内置默认。
// 密钥纪律：example 里绝不放真实 key；CLI provider 的 env 真值只写在 gitignored 的 eval.config.json。
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

/** CLI transport 的 provider（claude -p / codex exec 这类本地命令行模型通道）。 */
export type CliProviderConfig = {
    transport: "cli";
    /** 命令模板（数组参数，不拼 shell 字符串）；{MODEL} 占位符 = model id；prompt 一律走 stdin */
    command: string[];
    /** 注入子进程的环境变量（如 ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN）；真值只放 gitignored 配置 */
    env?: Record<string, string>;
    /** 该通道可用的 model id 列表（文档性质，不强校验） */
    models?: string[];
    /** 单次调用墙钟上限（CLI 启动慢，默认比 HTTP 宽） */
    timeoutMs?: number;
    /** 输出格式：json = 解析 claude -p --output-format json（拿真实 usage）；text = stdout 原文 */
    output?: "json" | "text";
};

export type RetryConfig = {maxAttempts: number; backoffBaseMs: number};
export type RateLimitRule = {concurrency: number; minIntervalMs: number};
export type DetectorConfig = {
    kind: string;
    /** gradio api_name（如 predict_zh） */
    endpoint: string;
    /** 分块目标字数（检测器只读前部窗口，见 task08 实测） */
    chunkChars: number;
    /** 相邻请求最小间隔（免费实例限速） */
    minIntervalMs: number;
    /** 版本标（space 不自报版本，用固定日期/revision；跨版本概率不可比） */
    version: string;
};

export type EvalConfig = {
    /** LLM HTTP provider 真相源（NeuroBook config.json）路径；相对 llmlint 仓根 */
    modelsConfig: string;
    /** reference 数据集根（catalog.json/manifest.tsv 所在）；跨仓绝对路径 */
    datasetsRoot?: string;
    /** render 模型面板（modelKey = provider/model，可混 HTTP 与 CLI provider） */
    renderModels: string[];
    /** brief 抽取器 modelKey（用 HTTP 模型：CLI 慢、贵） */
    extractor: string;
    /** prompt 版本选择（I8：版本 key 见 generator/prompts.ts） */
    prompts: {brief: string; render: string};
    retry: RetryConfig;
    rateLimit: {default: RateLimitRule; perProvider?: Record<string, RateLimitRule>};
    /** CLI transport providers（key = providerId，modelKey 写 `<providerId>/<modelId>`） */
    cliProviders?: Record<string, CliProviderConfig>;
    detector?: DetectorConfig;
};

const CONFIG_PATH = join(import.meta.dir, "..", "eval.config.json");
const EXAMPLE_PATH = join(import.meta.dir, "..", "eval.config.example.json");

const BUILTIN_DEFAULTS: EvalConfig = {
    modelsConfig: "workspace/.nbook/config.json",
    renderModels: ["deepseek/deepseek-v4-flash", "xiaomi-token-plan-cn/mimo-v2.5-pro", "doubao/doubao-seed-2-1-pro-260628"],
    extractor: "xiaomi-token-plan-cn/mimo-v2.5-pro",
    prompts: {brief: "brief-v2", render: "render-v1"},
    retry: {maxAttempts: 3, backoffBaseMs: 1000},
    rateLimit: {default: {concurrency: 1, minIntervalMs: 0}},
};

/**
 * 加载 eval 配置：eval.config.json > eval.config.example.json > 内置默认（浅合并，嵌套对象整体覆盖）。
 * @param explicitPath 显式配置路径（CLI --eval-config），跳过默认查找
 */
export function loadEvalConfig(explicitPath?: string): EvalConfig {
    const path = explicitPath ?? (existsSync(CONFIG_PATH) ? CONFIG_PATH : existsSync(EXAMPLE_PATH) ? EXAMPLE_PATH : undefined);
    if (!path) {
        return BUILTIN_DEFAULTS;
    }
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<EvalConfig>;
    return {
        ...BUILTIN_DEFAULTS,
        ...raw,
        prompts: {...BUILTIN_DEFAULTS.prompts, ...raw.prompts},
        retry: {...BUILTIN_DEFAULTS.retry, ...raw.retry},
        rateLimit: {default: raw.rateLimit?.default ?? BUILTIN_DEFAULTS.rateLimit.default, perProvider: raw.rateLimit?.perProvider},
    };
}

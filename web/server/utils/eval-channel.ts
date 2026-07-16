// eval.config.json 的 web 侧 mini 加载器（Task 13 W6 首建，W3/W4 抽成公共）：
// classify（W6 分类补空）/ detect（W3 外部检测器）/ llm-fix（W4 AI 改写）三条服务端通道共用。
//
// 为什么不用 evals/generator/eval-config.ts 的加载器：它的默认路径常量用 import.meta.dir
// （Bun 专有，nitro/node 下为 undefined，模块加载即抛 TypeError），只能复用其类型
// （import type 构建期擦除）；配置路径由 runtimeConfig.evalConfigPath 显式给出
// （构建期按仓根解析，运行期可用 NUXT_EVAL_CONFIG_PATH 覆盖）。
// 密钥纪律：key 只在 modelsConfig 指向的 NeuroBook config.json，绝不进本仓任何入 git 文件、不打进日志。
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, isAbsolute, join} from "node:path";
import {loadConfig, resolveModel, type ResolvedModel} from "evals-generator/config";
import {configureModelClient} from "evals-generator/model-client";
import {ProviderGate} from "evals-generator/rate-limit";
import type {EvalConfig} from "evals-generator/eval-config";

/** 一次配置读取的结果：ok=false 时 error 为可读原因（由各通道自行记日志并禁用）。 */
export type EvalConfigLoad =
    | {ok: true; config: Partial<EvalConfig>; configPath: string}
    | {ok: false; configPath: string; error: string};

/**
 * 读 eval.config.json（路径来自 runtimeConfig.evalConfigPath）。不缓存：各通道自己做惰性单例，
 * 本函数只在通道初始化时被调用一次，重复读的代价可忽略。
 */
export function readEvalConfig(): EvalConfigLoad {
    const configPath = typeof useRuntimeConfig === "function"
        ? useRuntimeConfig().evalConfigPath
        : process.env.NUXT_EVAL_CONFIG_PATH ?? join(dirname(fileURLToPath(import.meta.url)), "../../../evals/eval.config.json");
    try {
        return {ok: true, config: JSON.parse(readFileSync(configPath, "utf-8")) as Partial<EvalConfig>, configPath};
    } catch (error) {
        return {ok: false, configPath, error: error instanceof Error ? error.message : String(error)};
    }
}

/** model-client 全局配置只注入一次（多通道共读同一份 eval.config，首个初始化的通道生效，避免替换在用的限流 gate）。 */
let modelClientConfigured = false;

/**
 * 把 modelKey 解析成 HTTP 连接信息，并把 eval.config 的重试/限流注入 model-client（与 evals CLI 同一套）。
 * modelsConfig 相对路径按 llmlint 仓根解析（约定：eval.config.json 位于 <仓根>/evals/ 下）。
 * 任一环节失败直接抛（调用方 catch 后记日志并禁用该通道）。
 */
export function resolveChannelModel(config: Partial<EvalConfig>, configPath: string, modelKey: string): ResolvedModel {
    if (!config.modelsConfig) {
        throw new Error(`${configPath} 缺 modelsConfig 节`);
    }
    const repoRoot = join(dirname(configPath), "..");
    const modelsPath = isAbsolute(config.modelsConfig) ? config.modelsConfig : join(repoRoot, config.modelsConfig);
    const model = resolveModel(loadConfig(modelsPath), modelKey);
    // 重试/限流与 evals CLI 同一套；缺省值抄 eval-config.ts 的 BUILTIN_DEFAULTS。
    if (!modelClientConfigured) {
        configureModelClient({
            retry: config.retry ?? {maxAttempts: 3, backoffBaseMs: 1000},
            gate: new ProviderGate(config.rateLimit?.default ?? {concurrency: 1, minIntervalMs: 0}, config.rateLimit?.perProvider ?? {}),
        });
        modelClientConfigured = true;
    }
    return model;
}

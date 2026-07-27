// modelKey → 可调用模型的解析（HTTP / CLI 双通道 + 代理 + per-provider 超时）。
// 从 generate.ts 抽出：generate.ts 顶层自执行 CLI，无法被别的脚本 import，
// 而实验脚本需要同一套解析逻辑——复制一份必然随时间分叉。
import {isAbsolute, join} from "node:path";
import {resolveModel, type RawConfig} from "./config";
import {resolveCliModel} from "./cli-transport";
import type {AnyModel} from "./model-client";
import type {CliProviderConfig} from "./eval-config";

/** llmlint 仓根（generator 的上两级）：相对路径按它解析，cwd 无关（I10）。 */
export const REPO_ROOT = join(import.meta.dir, "..", "..");

/** 相对路径按 llmlint 仓根解析（跨仓引用 NeuroBook config.json 时 cwd 无关）。 */
export function resolveRepoPath(path: string): string {
    return isAbsolute(path) ? path : join(REPO_ROOT, path);
}

/** modelKey → HTTP 或 CLI 通道（providerId 命中 cliProviders 走 CLI）。proxy 注入 CLI 子进程；providerTimeouts 覆盖 HTTP 墙钟。 */
export function resolveAnyModel(config: RawConfig, modelKey: string, cliProviders: Record<string, CliProviderConfig>, proxy?: string, providerTimeouts?: Record<string, number>): AnyModel {
    const slash = modelKey.indexOf("/");
    const providerId = slash > 0 ? modelKey.slice(0, slash) : "";
    const cli = cliProviders[providerId];
    if (cli) {
        return resolveCliModel(providerId, modelKey.slice(slash + 1), cli, proxy);
    }
    const resolved = resolveModel(config, modelKey);
    // per-provider 超时覆盖（如 doubao 推理模型长章需要更长墙钟）。
    const override = providerTimeouts?.[providerId];
    return override ? {...resolved, timeoutMs: override} : resolved;
}

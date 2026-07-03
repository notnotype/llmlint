// 读 NeuroBook 的 workspace/.nbook/config.json,把 modelKey(provider/model)解析成连接信息。
// 不依赖服务端 config-service,直接读原始 JSON(schema 已知)。
import {readFileSync} from "node:fs";

type RawProvider = {
    id: string;
    name?: string;
    options: {apiKey: string; baseURL: string; timeoutMs?: number | null};
    models: Array<{id: string; name?: string; contextWindowTokens?: number | null; maxTokens?: number | null}>;
};
export type RawConfig = {models: {providers: RawProvider[]}};

export type ResolvedModel = {
    modelKey: string;
    providerId: string;
    modelId: string;
    name: string;
    baseURL: string;
    apiKey: string;
    contextWindow: number;
    maxTokens: number;
    timeoutMs: number;
    /** provider 兼容性标志（如小米 token plan 不支持 developer role、用 max_tokens 字段）。 */
    compat: Record<string, unknown> | undefined;
};

const DEFAULT_CONFIG_PATH = "workspace/.nbook/config.json";
const DEFAULT_CONTEXT_WINDOW = 256_000;
const DEFAULT_MODEL_MAX_TOKENS = 256_000;
const DEFAULT_TIMEOUT_MS = 360_000;
// 见 server/agent/harness/model-resolver.ts:23 —— 小米 token plan 的特殊兼容标志。
const XIAOMI_TOKEN_PLAN_COMPAT = {supportsDeveloperRole: false, maxTokensField: "max_tokens"};

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): RawConfig {
    return JSON.parse(readFileSync(path, "utf-8")) as RawConfig;
}

/** modelKey = `<provider.id>/<model.id>` → 完整连接信息。model-id 不在 config 列表内也放行（config 会过时），用 provider 连接 + 默认参数。 */
export function resolveModel(config: RawConfig, modelKey: string): ResolvedModel {
    const slash = modelKey.indexOf("/");
    if (slash <= 0 || slash === modelKey.length - 1) {
        throw new Error(`模型 key 格式错误（应为 provider/model）：${modelKey}`);
    }
    const providerId = modelKey.slice(0, slash);
    const modelId = modelKey.slice(slash + 1);
    const provider = config.models.providers.find((item) => item.id === providerId);
    if (!provider) {
        throw new Error(`provider 不存在：${providerId}（modelKey=${modelKey}）`);
    }
    if (!provider.options.apiKey?.trim()) {
        throw new Error(`provider ${providerId} 缺 apiKey`);
    }
    // model?: 允许 undefined —— 用模型发现拿到的新 id 常不在 config.models 里，仍可用 provider 连接直调。
    const model = provider.models.find((item) => item.id === modelId);
    if (!model) {
        console.warn(`⚠ 模型 ${modelKey} 不在 config.models 列表（可能是发现的新模型），用 provider 连接 + 默认参数调用。`);
    }
    return {
        modelKey,
        providerId,
        modelId,
        name: model?.name ?? modelId,
        baseURL: provider.options.baseURL,
        apiKey: provider.options.apiKey,
        contextWindow: model?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: model?.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS,
        timeoutMs: provider.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        compat: providerId === "xiaomi-token-plan-cn" ? {...XIAOMI_TOKEN_PLAN_COMPAT} : undefined,
    };
}

/** 只解析 provider 连接信息（供模型发现用）。 */
export function resolveProvider(config: RawConfig, providerId: string): {providerId: string; baseURL: string; apiKey: string; timeoutMs: number} {
    const provider = config.models.providers.find((item) => item.id === providerId);
    if (!provider) {
        throw new Error(`provider 不存在：${providerId}`);
    }
    if (!provider.options.apiKey?.trim()) {
        throw new Error(`provider ${providerId} 缺 apiKey`);
    }
    return {providerId, baseURL: provider.options.baseURL, apiKey: provider.options.apiKey, timeoutMs: provider.options.timeoutMs ?? DEFAULT_TIMEOUT_MS};
}

/** 模型短名,用于 render 文件名（provider-model → provider-model 去斜杠）。 */
export function modelSlug(modelKey: string): string {
    return modelKey.replace(/[/\\]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
}

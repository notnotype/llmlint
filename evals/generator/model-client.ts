// pi-ai 单次非流式生成封装。只依赖 @earendil-works/pi-ai（真包,bun 直接解析）,
// 不碰 nbook/ 服务端模块。模式照 server/utils/model-settings.ts 的 runPiModelSmokeCheck。
// CLI 通道（claude -p / codex exec）由 cli-transport 提供 completeOnce 等价物,共用下面同一套
// classifyOutcome / callWithRetry / 限流 —— 两种 transport 在 callModelDetailed 处汇合。
import {completeSimple} from "@earendil-works/pi-ai";
import type {Model} from "@earendil-works/pi-ai";
import type {ResolvedModel} from "./config";
import type {CliModel} from "./cli-transport";
import {completeCliOnce} from "./cli-transport";
import {ProviderGate} from "./rate-limit";
import type {RetryConfig} from "./eval-config";

// pi-ai 的 Message/Context/AssistantMessage 结构在内联处构造,用最小本地类型避免 nbook/ 依赖。
type AssistantBlock = {type: string; text?: string};
export type AssistantMessage = {content: AssistantBlock[]; stopReason?: string; errorMessage?: string; usage?: {input?: number; output?: number}};

/** HTTP（pi-ai）或 CLI 两种通道的已解析模型。 */
export type AnyModel = ResolvedModel | CliModel;
/** 一次成功调用的产物：正文 + 真实 usage（CLI text 通道无 usage → undefined，预算侧标"估算"）。 */
export type CallResult = {text: string; usage?: {input?: number; output?: number}};

const SMOKE_MAX_TOKENS = 32;
// 单次补全硬顶：pi-ai/provider 的内部超时对某些 provider（实测 xiaomi mimo）不生效，
// 一次挂起会阻塞整条串行生成 → 用墙钟兜底，正常补全 30-60s，4 分钟仍未回即判超时。
const HARD_TIMEOUT_CAP_MS = 240_000;
const MAX_ATTEMPTS = 3;              // 语义层重试上限（空输出/超时/瞬时错误）
const PI_MAX_RETRIES = 2;           // pi-ai 原生:HTTP 层 429/5xx 重试(与语义层正交)
const PI_MAX_RETRY_DELAY_MS = 20_000;

// 模块级可靠性配置：入口（generate/detect）按 eval.config 注入一次；不注入用内置默认。
let retryConfig: RetryConfig = {maxAttempts: MAX_ATTEMPTS, backoffBaseMs: 1000};
let providerGate = new ProviderGate();

/** 注入重试/限流配置（eval.config 的 retry + rateLimit）。 */
export function configureModelClient(options: {retry?: RetryConfig; gate?: ProviderGate}): void {
    if (options.retry) {
        retryConfig = options.retry;
    }
    if (options.gate) {
        providerGate = options.gate;
    }
}

/** 单次补全的分类结果（纯函数产出，驱动重试决策）。 */
export type Outcome =
    | {kind: "ok"; text: string; usage?: {input?: number; output?: number}}
    | {kind: "retry"; reason: string; detail: string}
    | {kind: "terminal"; reason: string; detail: string};

/** 构造 pi-ai Model（照 model-settings.ts:455 resolvePiModelForDraft，最小化）。 */
function buildPiModel(resolved: ResolvedModel): Model<"openai-completions"> {
    // pi-ai 的 Model 泛型很复杂；这里按运行时所需字段构造,用 as 收口（外部库类型）。
    return {
        id: resolved.modelId,
        name: resolved.name,
        api: "openai-completions",
        provider: resolved.providerId,
        baseUrl: resolved.baseURL,
        reasoning: false,
        input: ["text"],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: resolved.contextWindow,
        maxTokens: resolved.maxTokens,
        headers: {},
        compat: resolved.compat,
    } as unknown as Model<"openai-completions">;
}

/** 单次生成:system + user → 文本。按可靠性策略重试(见 callWithRetry);要么返非空文本、要么带分类原因抛错。 */
export async function callModel(resolved: AnyModel, system: string, user: string, maxTokens = 8000): Promise<string> {
    return (await callModelDetailed(resolved, system, user, maxTokens)).text;
}

/**
 * 单次生成的完整产物（含 usage）。HTTP/CLI 两通道在此汇合：
 * 都经限流 gate（按 providerId）+ 同一 callWithRetry（同一 classifyOutcome 裁决）。
 */
export async function callModelDetailed(resolved: AnyModel, system: string, user: string, maxTokens = 8000): Promise<CallResult> {
    const attempt = isCliModel(resolved)
        ? (): Promise<AssistantMessage> => completeCliOnce(resolved, system, user)
        : (): Promise<AssistantMessage> => completeOnce(resolved, system, user, maxTokens);
    return providerGate.run(resolved.providerId, () => callWithRetryDetailed(attempt, resolved.modelKey));
}

function isCliModel(model: AnyModel): model is CliModel {
    return (model as CliModel).kind === "cli";
}

/**
 * 一次补全 → AssistantMessage。stopReason=error 不在此抛(留给 classifyOutcome 看 errorMessage);
 * 只有网络/abort/墙钟超时才抛。这是可靠性 seam —— 测试给 callWithRetry 注入假 attempt 即可无网测重试。
 */
async function completeOnce(resolved: ResolvedModel, system: string, user: string, maxTokens: number): Promise<AssistantMessage> {
    const model = buildPiModel(resolved);
    const context = {
        systemPrompt: system,
        messages: [{role: "user", content: [{type: "text", text: user}], timestamp: Date.now()}],
        tools: [],
    };
    const capMs = Math.min(resolved.timeoutMs, HARD_TIMEOUT_CAP_MS);
    // 原生 signal 真正 abort fetch(Promise.race 不会)——round-04 挂起的正解;maxRetries 走 pi-ai 的 HTTP 层重试。
    const completion = completeSimple(model, context as never, {
        apiKey: resolved.apiKey,
        timeoutMs: capMs,
        signal: AbortSignal.timeout(capMs),
        maxRetries: PI_MAX_RETRIES,
        maxRetryDelayMs: PI_MAX_RETRY_DELAY_MS,
        maxTokens,
        reasoning: undefined,
        cacheRetention: "none",
    } as never) as unknown as Promise<AssistantMessage>;
    // 墙钟兜底:实测 xiaomi 内部超时曾不生效,双保险。
    return withTimeout(completion, capMs, resolved.modelKey);
}

/**
 * 重试循环:包裹一个 attempt（可注入假的做单测）。ok 返文本;terminal 立即抛;retry 退避后再来;耗尽抛。
 * 返回纯文本（历史签名，测试依赖）。带 usage 的版本见 callWithRetryDetailed。
 */
export async function callWithRetry(attempt: () => Promise<AssistantMessage>, label: string, maxAttempts = retryConfig.maxAttempts, sleepFn: (ms: number) => Promise<void> = sleep): Promise<string> {
    return (await callWithRetryDetailed(attempt, label, maxAttempts, sleepFn)).text;
}

/**
 * 重试循环（带 usage）：HTTP/CLI 通道共用。ok 返 {text, usage};terminal 立即抛;retry 退避后再来;耗尽抛。
 * 抛出的 Error 带分类原因 → 调用方日志能打出「为什么」(直接回答 doubao 空输出之谜)。
 */
export async function callWithRetryDetailed(attempt: () => Promise<AssistantMessage>, label: string, maxAttempts = retryConfig.maxAttempts, sleepFn: (ms: number) => Promise<void> = sleep): Promise<CallResult> {
    let last = "";
    for (let i = 0; i < maxAttempts; i += 1) {
        let outcome: Outcome;
        try {
            outcome = classifyOutcome({assistant: await attempt()});
        } catch (error) {
            outcome = classifyOutcome({error});
        }
        if (outcome.kind === "ok") {
            return {text: outcome.text, usage: outcome.usage};
        }
        last = `${outcome.reason}: ${outcome.detail}`;
        if (outcome.kind === "terminal") {
            throw new Error(`${label} 终态失败（${last}）`);
        }
        if (i < maxAttempts - 1) {
            console.warn(`  ↻ ${label} 重试 ${i + 1}/${maxAttempts - 1}（${last}）`);
            await sleepFn(retryConfig.backoffBaseMs * 2 ** i); // 退避基数 × 2^i（单测注入无操作 sleepFn 免等待）
        }
    }
    throw new Error(`${label} 重试 ${maxAttempts} 次仍失败（${last}）`);
}

/** 纯分类:把「一次补全的结果或异常」判成 ok / retry / terminal。无 I/O,可单测。 */
export function classifyOutcome(result: {assistant?: AssistantMessage; error?: unknown}): Outcome {
    if (result.error !== undefined) {
        return classifyMessage(result.error instanceof Error ? result.error.message : String(result.error));
    }
    const assistant = result.assistant!;
    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
        return classifyMessage(assistant.errorMessage ?? assistant.stopReason ?? "unknown error");
    }
    const text = extractText(assistant);
    if (text.length === 0) {
        const detail = `stopReason=${assistant.stopReason ?? "?"}, output_tokens=${assistant.usage?.output ?? "?"}`;
        // length + 无可见文本 = 推理模型把 maxTokens 全烧在 thinking 上被截断，重试同参数无益 → 终态（提示调大 maxTokens/关推理）。
        if (assistant.stopReason === "length") {
            return {kind: "terminal", reason: "length-no-visible-text（推理烧光 token 预算；调大 render maxTokens 或关推理）", detail};
        }
        // stop 但无 text：瞬时空，值得重试（附 usage 诊断「为什么」）。
        return {kind: "retry", reason: "empty-output", detail};
    }
    return {kind: "ok", text, usage: assistant.usage};
}

/** 错误消息 → 分类。终态(重试无益):context 溢出、鉴权/未激活/客户端错、内容拒答;其余 429/5xx/超时/网络 → 重试。 */
function classifyMessage(msg: string): Outcome {
    if (/context.?length|maximum context|context window|too long|exceed.*token|reduce the length|上下文/i.test(msg)) {
        return {kind: "terminal", reason: "context-overflow", detail: msg};
    }
    if (/\b400\b|\b401\b|\b403\b|\b404\b|unauthor|forbidden|permission|bad request|has not activated|activate the model|invalid.*api.?key|无权|未激活/i.test(msg)) {
        return {kind: "terminal", reason: "auth/client-error", detail: msg};
    }
    if (/content.?filter|safety|sensitive|risk.?control|violat|违规|敏感|拒绝/i.test(msg)) {
        return {kind: "terminal", reason: "refusal/filter", detail: msg};
    }
    if (/\b429\b|rate.?limit|quota|too many|\b5\d\d\b|timeout|超时|econn|network|fetch failed|aborted|socket/i.test(msg)) {
        return {kind: "retry", reason: "transient", detail: msg};
    }
    return {kind: "retry", reason: "error", detail: msg}; // 未知错误默认重试(便宜的乐观,上限 MAX_ATTEMPTS 兜底)
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 墙钟超时兜底:pi-ai/provider 内部超时对某些 provider 不生效,超时即抛(调用方 catch 后跳过该篇)。 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 补全超时(${Math.round(ms / 1000)}s)`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** 连通 smoke:回一句,返回 {text, latencyMs}。HTTP/CLI 通道都支持。 */
export async function smokeCheck(resolved: AnyModel): Promise<{text: string; latencyMs: number}> {
    const startedAt = Date.now();
    const text = await callModel(resolved, "You are a concise connectivity smoke test assistant.", "Reply with ok.", SMOKE_MAX_TOKENS);
    return {text, latencyMs: Date.now() - startedAt};
}

/**
 * 模型发现：GET {baseURL}/models（OpenAI 兼容）列出 provider 当前可用 model id。
 * config.json 会过时（如 doubao 列 2-0-pro，实际已有 2.1-pro）→ 用它拿真实 id。
 * 失败（不支持/网络）返回空数组 + 告警，不阻断（回退显式 id）。
 */
export async function discoverModels(provider: {providerId: string; baseURL: string; apiKey: string; timeoutMs: number}): Promise<string[]> {
    const url = `${provider.baseURL.replace(/\/+$/, "")}/models`;
    try {
        const response = await fetch(url, {
            headers: {Authorization: `Bearer ${provider.apiKey}`},
            signal: AbortSignal.timeout(Math.min(provider.timeoutMs, 30_000)),
        });
        if (!response.ok) {
            console.warn(`⚠ ${provider.providerId} 模型发现 ${response.status}：${url}`);
            return [];
        }
        const body = (await response.json()) as {data?: Array<{id?: string}>};
        return (body.data ?? []).map((item) => item.id ?? "").filter(Boolean);
    } catch (error) {
        console.warn(`⚠ ${provider.providerId} 模型发现失败：${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/** 取 assistant 文本：只保留 text block（丢弃 thinking/tool）,照 message-utils.ts:144 messageText。 */
function extractText(assistant: AssistantMessage): string {
    return (assistant.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text ?? "")
        .join("\n")
        .trim();
}

// pi-ai 单次非流式生成封装。只依赖 @earendil-works/pi-ai（真包,bun 直接解析）,
// 不碰 nbook/ 服务端模块。模式照 server/utils/model-settings.ts 的 runPiModelSmokeCheck。
// CLI 通道（claude -p / codex exec）由 cli-transport 提供 completeOnce 等价物,共用下面同一套
// classifyOutcome / callWithRetry / 限流 —— 两种 transport 在 callModelDetailed 处汇合。
import {completeSimple, streamSimple, type AssistantMessageEvent} from "@earendil-works/pi-ai";
import type {Model} from "@earendil-works/pi-ai";
import type {ResolvedModel} from "./config";
import type {CliModel} from "./cli-transport";
import {completeCliOnce} from "./cli-transport";
import {ProviderGate} from "./rate-limit";
import type {RetryConfig} from "./eval-config";

// pi-ai 的 Message/Context/AssistantMessage 结构在内联处构造,用最小本地类型避免 nbook/ 依赖。
type AssistantBlock = {type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown>};
export type AssistantMessage = {content: AssistantBlock[]; stopReason?: string; errorMessage?: string; usage?: {input?: number; output?: number}};
/** pi-ai 工具定义（parameters 为 typebox TSchema；本地最小类型）。 */
export type PiTool = {name: string; description: string; parameters: unknown};

/** HTTP（pi-ai）或 CLI 两种通道的已解析模型。 */
export type AnyModel = ResolvedModel | CliModel;
/** 一次成功调用的产物：正文 + 真实 usage（CLI text 通道无 usage → undefined，预算侧标"估算"）。 */
export type CallResult = {text: string; usage?: {input?: number; output?: number}};

const SMOKE_MAX_TOKENS = 32;
// 单次补全墙钟绝对上限：pi-ai/provider 内部超时对某些 provider（实测 xiaomi mimo）不生效，
// 一次挂起会阻塞整条串行生成 → 墙钟兜底。正常补全 30-60s；**推理模型（doubao-seed-2-1-pro）长章思考可达数分钟**，
// 故上限放宽到 600s（副作用：真挂起的兜底也变 600s）。具体每模型超时由 provider.timeoutMs 控（见 eval.config.providerTimeouts）。
const HARD_TIMEOUT_CAP_MS = 600_000;
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
async function completeOnce(resolved: ResolvedModel, system: string, user: string, maxTokens: number, tools: PiTool[] = []): Promise<AssistantMessage> {
    const model = buildPiModel(resolved);
    const context = {
        systemPrompt: system,
        messages: [{role: "user", content: [{type: "text", text: user}], timestamp: Date.now()}],
        tools,
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

/** 工具调用的分类结果：ok = 模型调了目标工具（带参数）。 */
export type ToolOutcome =
    | {kind: "ok"; toolArguments: Record<string, unknown>; usage?: {input?: number; output?: number}}
    | {kind: "retry"; reason: string; detail: string}
    | {kind: "terminal"; reason: string; detail: string};

/** 纯分类：一次补全是否产出了对目标工具的调用。无 I/O，可单测。 */
export function classifyToolOutcome(result: {assistant?: AssistantMessage; error?: unknown}, toolName: string): ToolOutcome {
    if (result.error !== undefined) {
        return classifyMessage(result.error instanceof Error ? result.error.message : String(result.error));
    }
    const assistant = result.assistant!;
    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
        return classifyMessage(assistant.errorMessage ?? assistant.stopReason ?? "unknown error");
    }
    const call = (assistant.content ?? []).find((block) => block.type === "toolCall" && block.name === toolName);
    if (call && call.arguments && typeof call.arguments === "object") {
        return {kind: "ok", toolArguments: call.arguments, usage: assistant.usage};
    }
    const detail = `stopReason=${assistant.stopReason ?? "?"}, text=${extractText(assistant).slice(0, 80)}`;
    if (assistant.stopReason === "length") {
        return {kind: "terminal", reason: "length-no-tool-call（token 预算内没调工具）", detail};
    }
    // 模型用散文回答而没调工具：重试（提示词已强制，多为瞬时不守指令）。
    return {kind: "retry", reason: "no-tool-call", detail};
}

/**
 * 强制工具调用：system+user+单工具 → 该工具的参数对象。仅 HTTP 通道（CLI 无工具协议）。
 * 与 callModelDetailed 同一套 gate/重试语义；参数白名单校验由调用方做（本层只保证"调了工具"）。
 */
export async function callModelForTool(resolved: AnyModel, system: string, user: string, tool: PiTool, maxTokens = 2000): Promise<{toolArguments: Record<string, unknown>; usage?: {input?: number; output?: number}}> {
    if (isCliModel(resolved)) {
        throw new Error(`${resolved.modelKey} 是 CLI 通道，不支持工具调用（分类器请配 HTTP 模型）`);
    }
    return providerGate.run(resolved.providerId, async () => {
        let last = "";
        for (let i = 0; i < retryConfig.maxAttempts; i += 1) {
            let outcome: ToolOutcome;
            try {
                outcome = classifyToolOutcome({assistant: await completeOnce(resolved, system, user, maxTokens, [tool])}, tool.name);
            } catch (error) {
                outcome = classifyToolOutcome({error}, tool.name);
            }
            if (outcome.kind === "ok") {
                return {toolArguments: outcome.toolArguments, usage: outcome.usage};
            }
            last = `${outcome.reason}: ${outcome.detail}`;
            if (outcome.kind === "terminal") {
                throw new Error(`${resolved.modelKey} 工具调用终态失败（${last}）`);
            }
            if (i < retryConfig.maxAttempts - 1) {
                console.warn(`  ↻ ${resolved.modelKey} 工具调用重试 ${i + 1}/${retryConfig.maxAttempts - 1}（${last}）`);
                await sleep(retryConfig.backoffBaseMs * 2 ** i);
            }
        }
        throw new Error(`${resolved.modelKey} 工具调用重试 ${retryConfig.maxAttempts} 次仍失败（${last}）`);
    });
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

/** 错误消息 → 分类。终态(重试无益):context 溢出、鉴权/未激活/客户端错、内容拒答;其余 429/5xx/超时/网络 → 重试。只产 retry/terminal（Outcome 与 ToolOutcome 共用）。 */
function classifyMessage(msg: string): {kind: "retry" | "terminal"; reason: string; detail: string} {
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

// ─────────────────── 多轮 agent 通道（Task 18 新增；上面全部既有路径一字不动） ───────────────────

/**
 * 一轮 agent 补全的上下文：完整消息历史 + 工具集。messages 元素是 pi-ai 的 Message
 * （user / assistant 原样回填 / toolResult），本文件沿最小本地类型纪律用 unknown[] 承载，
 * 形态由调用方（agent-loop.ts）负责构造正确。
 */
export type AgentTurnContext = {
    systemPrompt: string;
    messages: unknown[];
    tools: PiTool[];
    /** Pi 原生 assistant 流事件；Harness 用它投影 text/thinking/tool args。 */
    onEvent?: (event: AssistantMessageEvent) => void | Promise<void>;
};

/**
 * 多轮 agent 循环里的**一轮**补全：完整消息历史 → AssistantMessage（含 toolCall block，原样可回填 messages）。
 * 与 callModelDetailed 同一套 gate/重试底座，但裁决口径不同（见 classifyTurnOutcome）：
 * - toolUse / stop 都是合法结束（stop+纯文本在多轮语境是自然收尾，成功与否由业务层按已应用编辑数裁决）——
 *   与 callModelForTool 的单轮 no-tool-call 重试语义**有意不同**；
 * - 传输层错误（429/5xx/超时/网络）重发同一轮（messages 不变）；auth/溢出/拒答/length 终态抛出，终止整个 loop。
 * 仅 HTTP 通道（CLI 无工具协议）。单轮墙钟 min(timeoutMs, 120s)——多轮循环不该有单轮长思考，
 * 挂起要快速止损（推理模型单轮超 120s 时再考虑配置化）。
 */
export async function callModelTurn(resolved: ResolvedModel, context: AgentTurnContext, maxTokens: number, signal?: AbortSignal): Promise<AssistantMessage> {
    const capMs = Math.min(resolved.timeoutMs, 120_000);
    const attempt = (): Promise<AssistantMessage> => {
        const model = buildPiModel(resolved);
        const completion = (async (): Promise<AssistantMessage> => {
            const stream = streamSimple(model, {
                systemPrompt: context.systemPrompt,
                messages: context.messages,
                tools: context.tools,
            } as never, {
                apiKey: resolved.apiKey,
                timeoutMs: capMs,
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(capMs)]) : AbortSignal.timeout(capMs),
                maxRetries: PI_MAX_RETRIES,
                maxRetryDelayMs: PI_MAX_RETRY_DELAY_MS,
                maxTokens,
                reasoning: undefined,
                cacheRetention: "none",
            } as never);
            for await (const event of stream) {
                await context.onEvent?.(event);
            }
            return await stream.result();
        })();
        return withTimeout(completion, capMs, resolved.modelKey);
    };
    return providerGate.run(resolved.providerId, async () => {
        let last = "";
        for (let i = 0; i < retryConfig.maxAttempts; i += 1) {
            let outcome: TurnOutcome;
            try {
                outcome = classifyTurnOutcome({assistant: await attempt()});
            } catch (error) {
                outcome = classifyTurnOutcome({error});
            }
            if (outcome.kind === "ok") {
                return outcome.assistant;
            }
            last = `${outcome.reason}: ${outcome.detail}`;
            if (outcome.kind === "terminal") {
                throw new Error(`${resolved.modelKey} agent 轮终态失败（${last}）`);
            }
            if (i < retryConfig.maxAttempts - 1) {
                console.warn(`  ↻ ${resolved.modelKey} agent 轮重试 ${i + 1}/${retryConfig.maxAttempts - 1}（${last}）`);
                await sleep(retryConfig.backoffBaseMs * 2 ** i);
            }
        }
        throw new Error(`${resolved.modelKey} agent 轮重试 ${retryConfig.maxAttempts} 次仍失败（${last}）`);
    });
}

/** 一轮 agent 补全的分类结果：ok = 拿到可回填的 AssistantMessage（toolUse 或 stop 皆可）。 */
export type TurnOutcome =
    | {kind: "ok"; assistant: AssistantMessage}
    | {kind: "retry"; reason: string; detail: string}
    | {kind: "terminal"; reason: string; detail: string};

/** 纯分类（无 I/O 可单测）：多轮语境下 toolUse/stop 都是 ok；length 终态（半截工具调用不可回填）；error/aborted 走消息分类。 */
export function classifyTurnOutcome(result: {assistant?: AssistantMessage; error?: unknown}): TurnOutcome {
    if (result.error !== undefined) {
        return classifyMessage(result.error instanceof Error ? result.error.message : String(result.error));
    }
    const assistant = result.assistant!;
    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
        return classifyMessage(assistant.errorMessage ?? assistant.stopReason ?? "unknown error");
    }
    if (assistant.stopReason === "length") {
        return {kind: "terminal", reason: "length（token 预算内没完成本轮；调大 maxTokensPerTurn）", detail: `text=${extractText(assistant).slice(0, 80)}`};
    }
    return {kind: "ok", assistant};
}

// ─────────────────── 流式通道（Task 15 P0-B 新增；上面全部非流式路径一字不动） ───────────────────

/**
 * 流式回调：每收到一段增量文本调用一次。
 * - delta = 本次增量；accumulated = **本次 attempt 内**到目前为止的累积全文。
 * - 重试语义注意：某次 attempt 中途失败进入重试时，下一次 attempt 的 accumulated 从空串重新累积——
 *   消费方必须用「整段覆盖」方式落存 accumulated（如 `job.partial = accumulated`），不要自行拼接 delta，
 *   否则重试会把两次 attempt 的文本拼在一起。
 */
export type StreamChunkHandler = (delta: string, accumulated: string) => void;

/**
 * 流式单次生成（OpenAI 兼容 chat/completions SSE）：system + user → 文本，逐 chunk 回调 onChunk。
 * 与 callModelDetailed 完全同一套可靠性语义：providerGate 按 providerId 限流 +
 * callWithRetryDetailed / classifyOutcome 裁决 ok / retry / terminal（HTTP 4xx/5xx、拒答、
 * 空输出、length 截断的归类口径一致）。
 *
 * 实现路径申报：pi-ai 的 completeSimple 是非流式封装，其流式 API 是 agent 事件流、
 * 与本文件 AssistantMessage 汇合点不匹配 → 按同一 ResolvedModel 连接信息
 * （baseURL / apiKey / modelId / timeoutMs）走原生 fetch SSE 解析（mimo 等目标 provider
 * 均为 OpenAI 兼容 SSE）。仅 HTTP 通道——CLI 通道无流式协议，参数类型只收 ResolvedModel。
 */
export async function callModelStreamDetailed(resolved: ResolvedModel, system: string, user: string, maxTokens = 8000, onChunk?: StreamChunkHandler): Promise<CallResult> {
    const attempt = (): Promise<AssistantMessage> => streamOnce(resolved, system, user, maxTokens, onChunk);
    return providerGate.run(resolved.providerId, () => callWithRetryDetailed(attempt, resolved.modelKey));
}

/**
 * 一次流式补全 → AssistantMessage（与 completeOnce 同一 seam 语义：结果交 classifyOutcome 归类，
 * 网络/HTTP 非 2xx/超时/流中断在此抛，由 classifyMessage 判 retry / terminal）。
 * 请求体按 OpenAI 兼容口径用 `max_tokens` 字段（mimo 等 token-plan provider 只认它，
 * 见 config.ts 的 XIAOMI_TOKEN_PLAN_COMPAT 注记；其余 OpenAI 兼容 provider 也接受该经典字段）。
 */
async function streamOnce(resolved: ResolvedModel, system: string, user: string, maxTokens: number, onChunk?: StreamChunkHandler): Promise<AssistantMessage> {
    const capMs = Math.min(resolved.timeoutMs, HARD_TIMEOUT_CAP_MS);
    const url = `${resolved.baseURL.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Bearer ${resolved.apiKey}`},
        body: JSON.stringify({
            model: resolved.modelId,
            stream: true,
            max_tokens: maxTokens,
            messages: [
                {role: "system", content: system},
                {role: "user", content: user},
            ],
        }),
        // signal 同时约束请求与响应体读取（undici/bun 语义）：整次流式读取共用 capMs 墙钟，
        // 对应非流式路径的 withTimeout 兜底（流式无需 Promise.race，abort 会让 read() 直接 reject）。
        signal: AbortSignal.timeout(capMs),
    });
    if (!response.ok) {
        // 状态码进错误消息 → classifyMessage 按 400/401/429/5xx 归类 terminal/retry（与非流式同口径）。
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`${resolved.modelKey} HTTP ${response.status}：${detail}`);
    }
    if (!response.body) {
        throw new Error(`${resolved.modelKey} 流式响应无 body`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";          // 跨 read() 的行缓冲（一帧 SSE 可能被 TCP 分包切开）
    let accumulated = "";     // 本次 attempt 的累积正文
    let stopReason: string | undefined;
    let usage: {input?: number; output?: number} | undefined;
    let sawDone = false;      // 收到 `data: [DONE]` 结束帧
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, {stream: true});
            // OpenAI 兼容流只用 `data:` 行（无 event:/id: 字段），逐行解析即可；空行是事件分隔符，跳过。
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex !== -1) {
                const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
                buffer = buffer.slice(newlineIndex + 1);
                newlineIndex = buffer.indexOf("\n");
                if (!line.startsWith("data:")) {
                    continue;
                }
                const payload = line.slice(5).trim();
                if (payload.length === 0) {
                    continue;
                }
                if (payload === "[DONE]") {
                    sawDone = true;
                    continue;
                }
                // 数据帧解析失败即抛（丢一帧 delta = 正文缺一段，宁可整次重试也不返回残缺文本）。
                const chunk = JSON.parse(payload) as {
                    choices?: Array<{delta?: {content?: string | null}; finish_reason?: string | null}>;
                    usage?: {prompt_tokens?: number; completion_tokens?: number};
                };
                const choice = chunk.choices?.[0];
                const delta = choice?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                    accumulated += delta;
                    onChunk?.(delta, accumulated);
                }
                if (choice?.finish_reason) {
                    stopReason = choice.finish_reason;
                }
                // 部分 provider 在末帧带 usage（无需 stream_options）；有就取，没有 usage 缺省（CallResult 允许）。
                if (chunk.usage) {
                    usage = {input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens};
                }
            }
        }
    } finally {
        // 出错/正常结束都释放底层连接（cancel 对已完成的流是 no-op）。
        void reader.cancel().catch(() => undefined);
    }
    // 既没收到 finish_reason 也没收到 [DONE] = 流被中途掐断——返回 ok 会把截断文本当完整结果，
    // 必须抛出走重试（classifyMessage 默认归 retry）。
    if (stopReason === undefined && !sawDone) {
        throw new Error(`${resolved.modelKey} 流式响应中断（未收到 finish_reason/[DONE]，已收 ${accumulated.length} 字符）`);
    }
    return {content: [{type: "text", text: accumulated}], stopReason: stopReason ?? "stop", usage};
}

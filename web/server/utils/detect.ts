// W3：外部 AIGC 检测器服务端通道（Task 13 D-C 机器信号仅服务器写；CONTEXT machine-detect）。
// revision 创建后异步调 HF yuchuantian/AIGC_text_detector（gradio Space），落 MachineDetect
// （docPAi=长度加权 mean、maxPAi、chunksJson=[{span,pAi}] 热力图槽位；UI 消费后置，数据先收）。
//
// 复用口径：句界分块用 evals/detector/chunk.ts 的纯函数（chunkChars 与 evals 同源 = 落库口径可比）；
// gradio 协议（POST → event_id → SSE）与 P(AI) 归一化/长度加权聚合照 evals/detector/hf-client.ts
// 同算法——hf-client 的 IO 用全局 fetch、无 dispatcher 注入点，而 nitro=node/undici 不吃 proxy
// 环境变量、HF 国内访问又必须走代理，故 IO 薄层在此按同协议实现（工单预判的备选路径）。
// 代理实现：node-fetch-native/proxy 的 createFetch（nitro 自带传递依赖，内部即 undici ProxyAgent
// dispatcher；undici 包本身在 Node 24 不可直接 import，见执行记录）——按通道构造，不污染全局 fetch。
// import 走 `node-fetch-native-proxy` 独立别名（nitro 对该包的内置别名会破坏子路径解析，见 nuxt.config）。
//
// 失败纪律：任何异常只记结构化日志、不落行、不上抛（调用方经 event.waitUntil 挂在响应后）；
// 单块重试沿 hf-client 口径（退避 ×3），整次 detect 设总超时上限防悬挂；配置缺失=通道禁用只记日志。
import {chunkBySentence, visibleLen} from "evals-detector/chunk";
import {createFetch} from "node-fetch-native-proxy";
import {ProviderGate} from "evals-generator/rate-limit";
import {readEvalConfig} from "./eval-channel";
import {prisma} from "../database/prisma";

/** 就绪的检测通道：代理 fetch + 检测器口径（name/version/chunkChars 即落库自然键）+ 进程级限流 gate。 */
type DetectChannel = {
    fetch: typeof globalThis.fetch;
    /** 落库 detectorName，如 "hf:yuchuantian-aigc-text-detector:predict_zh"（与 evals sidecar 同命名） */
    name: string;
    version: string;
    endpoint: string;
    chunkChars: number;
    minIntervalMs: number;
    space: string;
    /** 相邻 HF 请求的进程级串行 + 最小间隔（并发上传共享同一免费实例限速） */
    gate: ProviderGate;
};

// 通道单例：undefined=尚未初始化；null=初始化失败已禁用（修改 eval 配置后需重启服务生效）。
let channel: DetectChannel | null | undefined;
const runControllers = new Map<string, AbortController>();

// 与 evals/detector/hf-client.ts 的 DEFAULT_SPACE 一致（DetectorConfig 无 space 字段，单实现）。
const DEFAULT_SPACE = "yuchuantian-aigc-text-detector.hf.space";
// 整次 detect 墙钟上限：长文分块 × 节流可能 30s+，超限判失败防 waitUntil 悬挂。
const DETECT_TOTAL_TIMEOUT_MS = 120_000;
// 单块重试上限（沿 hf-client maxRetries 默认）。
const CHUNK_MAX_RETRIES = 3;

/**
 * 惰性初始化检测通道：读 eval.config.json 的 detector 节 + proxy。
 * kind 仅支持 hf-yuchuantian（evals 同款实现）；proxy 缺失时降级直连并在日志注明
 * （HF 国内访问预期必须走代理，直连仅供有直连网络的部署）。失败=禁用只记日志。
 */
function resolveChannel(): DetectChannel | null {
    if (channel !== undefined) {
        return channel;
    }
    channel = null;
    const loaded = readEvalConfig();
    if (!loaded.ok) {
        console.warn(`[detect] 通道禁用：读不到 eval 配置 ${loaded.configPath}（${loaded.error}）`);
        return channel;
    }
    const detector = loaded.config.detector;
    if (!detector) {
        console.warn(`[detect] 通道禁用：${loaded.configPath} 缺 detector 节`);
        return channel;
    }
    if (detector.kind !== "hf-yuchuantian") {
        console.warn(`[detect] 通道禁用：不支持的 detector.kind=${detector.kind}（当前仅 hf-yuchuantian）`);
        return channel;
    }
    const proxy = loaded.config.proxy;
    channel = {
        // 有代理配置 → 该通道专属的代理 fetch（undici ProxyAgent dispatcher，不改全局）；无 → 直连。
        fetch: proxy ? createFetch({url: proxy, noProxy: []}) : globalThis.fetch,
        name: `hf:${DEFAULT_SPACE.split(".")[0]}:${detector.endpoint}`,
        version: detector.version,
        endpoint: detector.endpoint,
        chunkChars: detector.chunkChars,
        minIntervalMs: detector.minIntervalMs,
        space: DEFAULT_SPACE,
        gate: new ProviderGate({concurrency: 1, minIntervalMs: detector.minIntervalMs}),
    };
    console.info(`[detect] 通道就绪：${channel.name}@${channel.version} chunkChars=${channel.chunkChars}（${proxy ? `代理 ${proxy}` : "直连（无 proxy 配置）"}）`);
    return channel;
}

/**
 * 对一个 revision 正文跑外部检测并落 MachineDetect（幂等：同口径已测过则跳过）。
 * 绝不抛错：任何失败只记日志、不落行、不重试风暴（单块内沿 hf-client 既有重试即可）。
 * 调用方：texts.post / revisions.post 的 event.waitUntil、llm-fix job 完成后。
 */
export async function recordMachineDetect(revisionId: string, body: string): Promise<void> {
    const last = await prisma.machineDetectRun.findFirst({where: {revisionId}, orderBy: {attempt: "desc"}, select: {attempt: true}});
    const run = await prisma.machineDetectRun.create({data: {revisionId, attempt: (last?.attempt ?? 0) + 1}});
    const controller = new AbortController();
    runControllers.set(run.id, controller);
    await prisma.machineDetectRun.update({where: {id: run.id}, data: {status: "running", startedAt: new Date()}});
    try {
        await detectAndStore(revisionId, body, controller.signal);
        await prisma.machineDetectRun.update({where: {id: run.id}, data: {status: "completed", finishedAt: new Date()}});
    } catch (error) {
        const cancelled = controller.signal.aborted;
        await prisma.machineDetectRun.update({where: {id: run.id}, data: {status: cancelled ? "cancelled" : "failed", error: cancelled ? "用户取消" : error instanceof Error ? error.message : String(error), finishedAt: new Date()}});
    } finally {
        runControllers.delete(run.id);
    }
}

/** 对一个 revision 重试外部检测，返回新 run id；实际运行由调用方 waitUntil。 */
export async function createMachineDetectRetry(revisionId: string): Promise<{runId: string; task: Promise<void>}> {
    const revision = await prisma.revision.findUniqueOrThrow({where: {id: revisionId}, select: {body: true}});
    const last = await prisma.machineDetectRun.findFirst({where: {revisionId}, orderBy: {attempt: "desc"}, select: {attempt: true}});
    const run = await prisma.machineDetectRun.create({data: {revisionId, attempt: (last?.attempt ?? 0) + 1}});
    const controller = new AbortController();
    runControllers.set(run.id, controller);
    const task = (async () => {
        await prisma.machineDetectRun.update({where: {id: run.id}, data: {status: "running", startedAt: new Date()}});
        try {
            await detectAndStore(revisionId, revision.body, controller.signal);
            await prisma.machineDetectRun.update({where: {id: run.id}, data: {status: "completed", finishedAt: new Date()}});
        } catch (error) {
            const cancelled = controller.signal.aborted;
            await prisma.machineDetectRun.update({where: {id: run.id}, data: {status: cancelled ? "cancelled" : "failed", error: cancelled ? "用户取消" : error instanceof Error ? error.message : String(error), finishedAt: new Date()}});
        } finally {
            runControllers.delete(run.id);
        }
    })();
    return {runId: run.id, task};
}

/** 取消一个外部检测 run。 */
export async function cancelMachineDetectRun(runId: string, revisionId: string): Promise<void> {
    const run = await prisma.machineDetectRun.findFirst({where: {id: runId, revisionId}});
    if (!run) {
        throw createError({statusCode: 404, message: "外部检测任务不存在"});
    }
    if (run.status !== "queued" && run.status !== "running") {
        return;
    }
    runControllers.get(runId)?.abort("user_cancelled");
    await prisma.machineDetectRun.update({where: {id: runId}, data: {status: "cancelled", error: "用户取消", finishedAt: new Date()}});
}

/** 服务重启后的悬空运行统一标为 interrupted。 */
export async function reconcileDetectRuns(): Promise<void> {
    await prisma.machineDetectRun.updateMany({where: {status: {in: ["queued", "running"]}}, data: {status: "interrupted", error: "服务重启，运行已中断", finishedAt: new Date()}});
}

/** 最新运行状态供 machine DTO 投影。 */
export async function latestMachineDetectRun(revisionId: string) {
    return prisma.machineDetectRun.findFirst({where: {revisionId}, orderBy: {attempt: "desc"}});
}

async function detectAndStore(revisionId: string, body: string, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    try {
        signal.throwIfAborted();
        const active = resolveChannel();
        if (!active) {
            throw new Error("外部检测通道未配置");
        }
        // 幂等第一道：@@unique(revisionId, detectorName, detectorVersion, chunkChars) 已有行即跳过。
        const existing = await prisma.machineDetect.findFirst({
            where: {revisionId, detectorName: active.name, detectorVersion: active.version, chunkChars: active.chunkChars},
            select: {id: true},
        });
        if (existing) {
            console.info(`[detect] 跳过 revisionId=${revisionId}：同口径已有记录`);
            return;
        }
        const chunks = chunkBySentence(body, active.chunkChars);
        if (chunks.length === 0) {
            console.info(`[detect] 跳过 revisionId=${revisionId}：正文无可检测内容`);
            return;
        }
        // 逐块打分（进程级串行 + 节流），总超时兜底。
        const deadline = startedAt + DETECT_TOTAL_TIMEOUT_MS;
        const scored: Array<{span: {start: number; end: number}; pAi: number; weight: number}> = [];
        for (const chunk of chunks) {
            signal.throwIfAborted();
            const {label, prob} = await active.gate.run("hf-detector", () => scoreChunk(active, chunk.text, deadline, signal));
            scored.push({span: {start: chunk.start, end: chunk.end}, pAi: toPAi(label, prob), weight: Math.max(1, visibleLen(chunk.text))});
        }
        // 文档级聚合：长度加权 mean（主指标）+ max（与 hf-client.aggregate 同算法）。
        const weightSum = scored.reduce((sum, item) => sum + item.weight, 0);
        const docPAi = scored.reduce((sum, item) => sum + item.pAi * item.weight, 0) / weightSum;
        const maxPAi = Math.max(...scored.map((item) => item.pAi));
        try {
            await prisma.machineDetect.create({
                data: {
                    revisionId,
                    detectorName: active.name,
                    detectorVersion: active.version,
                    chunkChars: active.chunkChars,
                    docPAi,
                    maxPAi,
                    chunksJson: JSON.stringify(scored.map(({span, pAi}) => ({span, pAi}))),
                },
            });
        } catch (error) {
            // 幂等第二道：并发触发撞 @@unique → 已有结果，按跳过处理。
            if ((error as {code?: string}).code === "P2002") {
                console.info(`[detect] 跳过 revisionId=${revisionId}：并发写入已有记录`);
                return;
            }
            throw error;
        }
        console.info(`[detect] 完成 revisionId=${revisionId} 耗时=${Date.now() - startedAt}ms 块=${scored.length} docPAi=${docPAi.toFixed(4)} maxPAi=${maxPAi.toFixed(4)}`);
    } catch (error) {
        console.warn(`[detect] 失败 revisionId=${revisionId} 耗时=${Date.now() - startedAt}ms：${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

/** 单块打分：重试 + 退避（HF 免费实例冷启动 503/网络抖动），每次尝试前检查总超时余量。 */
async function scoreChunk(active: DetectChannel, text: string, deadline: number, signal: AbortSignal): Promise<{label: string; prob: number}> {
    for (let attempt = 0; attempt < CHUNK_MAX_RETRIES; attempt += 1) {
        if (Date.now() >= deadline) {
            throw new Error(`detect 总超时（${DETECT_TOTAL_TIMEOUT_MS / 1000}s）`);
        }
        try {
            signal.throwIfAborted();
            return await callGradio(active, text, deadline, signal);
        } catch (error) {
            if (attempt === CHUNK_MAX_RETRIES - 1) {
                throw error;
            }
            await sleep(active.minIntervalMs * 2 ** attempt, signal); // 退避同样响应真实取消
        }
    }
    throw new Error("unreachable");
}

/**
 * 一次 gradio 调用（协议与 hf-client.callGradio 同）：POST {data:[text]} → {event_id} → GET SSE → ["标签","prob"]。
 * 每段 fetch 的超时取「hf-client 同款上限」与「总超时余量」的较小值。
 */
async function callGradio(active: DetectChannel, text: string, deadline: number, signal: AbortSignal): Promise<{label: string; prob: number}> {
    const base = `https://${active.space}/gradio_api/call/${active.endpoint}`;
    const post = await active.fetch(base, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({data: [text]}),
        signal: AbortSignal.any([signal, AbortSignal.timeout(budget(deadline, 60_000))]),
    });
    if (!post.ok) {
        throw new Error(`detector POST ${post.status}`);
    }
    const eventId = ((await post.json()) as {event_id?: string}).event_id;
    if (!eventId) {
        throw new Error("detector 无 event_id");
    }
    const stream = await active.fetch(`${base}/${eventId}`, {signal: AbortSignal.any([signal, AbortSignal.timeout(budget(deadline, 120_000))])});
    const sse = await stream.text();
    const parsed = parseSse(sse);
    if (!parsed) {
        throw new Error(`detector SSE 无 data：${sse.slice(0, 120)}`);
    }
    return parsed;
}

/** 剩余预算（不小于 1ms，超时交给 AbortSignal 立刻打断）。 */
function budget(deadline: number, cap: number): number {
    return Math.max(1, Math.min(cap, deadline - Date.now()));
}

/** 解析 gradio SSE：找 `data: ["标签","0.99"]` 那行（与 hf-client.parseSse 同）。 */
function parseSse(body: string): {label: string; prob: number} | null {
    for (const line of body.split(/\r?\n/u)) {
        if (!line.startsWith("data:")) {
            continue;
        }
        try {
            const arr = JSON.parse(line.slice(5).trim()) as unknown;
            if (Array.isArray(arr) && arr.length >= 2) {
                return {label: String(arr[0]), prob: Number(arr[1])};
            }
        } catch {
            // 非 JSON 的 data 行（心跳等）跳过
        }
    }
    return null;
}

/** 归一化到 P(AI)：标签是 AI → prob；标签是人类 → 1−prob（与 hf-client.toPAi 同）。 */
function toPAi(label: string, prob: number): number {
    const isAi = /ai|机器|生成/i.test(label) && !/人|human/i.test(label);
    return isAi ? prob : 1 - prob;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(signal.reason instanceof Error ? signal.reason : new DOMException("已取消", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, {once: true});
    });
}

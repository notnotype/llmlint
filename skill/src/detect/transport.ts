// 移植自 evals/detector/hf-client.ts，并按 skill CLI 拆出纯接口、代理 fetch 与可测试聚合函数。
import {DEFAULT_DETECTOR_CHUNK_CHARS, DEFAULT_DETECTOR_ENDPOINT, DEFAULT_DETECTOR_MIN_INTERVAL_MS, DEFAULT_DETECTOR_SPACE, DEFAULT_DETECTOR_VERSION} from "../user-state";
import {visibleLen, type Chunk} from "./chunk";

export type DetectorOptions = {
    space: string;
    endpoint: string;
    version: string;
    chunkChars: number;
    minIntervalMs: number | null;
    proxy: string | null;
};

export type ChunkScore = {
    span: [number, number];
    pAi: number;
    line: number;
};

export type DetectPayload = {
    detector: {
        version: string;
        endpoint: string;
        space: string;
        chunkChars: number;
    };
    docPAi: number;
    maxPAi: number;
    chunks: ChunkScore[];
};

/** 神经检测传输层：输入分块文本，输出每块 P(AI)。实现负责限速/重试。 */
export interface DetectorTransport {
    detectChunks(chunks: string[]): Promise<number[]>;
}

type FetchLike = typeof globalThis.fetch;
type ResolvedDetectorOptions = Omit<DetectorOptions, "minIntervalMs"> & {minIntervalMs: number};

const MAX_RETRIES = 3;

/** HF gradio Space 传输：POST 获取 event_id，再 GET SSE 取标签与概率。 */
export class HfTransport implements DetectorTransport {
    private readonly options: ResolvedDetectorOptions;
    private readonly fetcherPromise: Promise<FetchLike>;
    private lastCallAt = 0;

    constructor(options: Partial<DetectorOptions> = {}) {
        const minIntervalMs = options.minIntervalMs ?? DEFAULT_DETECTOR_MIN_INTERVAL_MS;
        this.options = {
            space: DEFAULT_DETECTOR_SPACE,
            endpoint: DEFAULT_DETECTOR_ENDPOINT,
            version: DEFAULT_DETECTOR_VERSION,
            chunkChars: DEFAULT_DETECTOR_CHUNK_CHARS,
            proxy: null,
            ...options,
            minIntervalMs,
        };
        this.fetcherPromise = createRuntimeFetch(this.options.proxy);
    }

    /** 串行检测每个文本块，复用同一 transport 的全局限速。 */
    async detectChunks(chunks: string[]): Promise<number[]> {
        const scores: number[] = [];
        for (const chunk of chunks) {
            const {label, prob} = await this.scoreChunk(chunk);
            scores.push(toPAi(label, prob));
        }
        return scores;
    }

    private async scoreChunk(text: string): Promise<{label: string; prob: number}> {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
            await this.throttle();
            try {
                return await this.callGradio(text);
            } catch (error) {
                if (attempt === MAX_RETRIES - 1) {
                    throw error;
                }
                await sleep(this.options.minIntervalMs * 2 ** attempt);
            }
        }
        throw new Error("unreachable");
    }

    private async throttle(): Promise<void> {
        const wait = this.lastCallAt + this.options.minIntervalMs - Date.now();
        if (wait > 0) {
            await sleep(wait);
        }
        this.lastCallAt = Date.now();
    }

    private async callGradio(text: string): Promise<{label: string; prob: number}> {
        const fetcher = await this.fetcherPromise;
        const base = `https://${this.options.space}/gradio_api/call/${this.options.endpoint}`;
        const post = await fetcher(base, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({data: [text]}),
            signal: AbortSignal.timeout(60_000),
        });
        if (!post.ok) {
            throw new Error(`detector POST ${post.status}`);
        }
        const postBody = await post.json() as {event_id?: string};
        const eventId = postBody.event_id;
        if (!eventId) {
            throw new Error("detector 无 event_id");
        }
        const stream = await fetcher(`${base}/${eventId}`, {signal: AbortSignal.timeout(120_000)});
        const sse = await stream.text();
        const parsed = parseSse(sse);
        if (!parsed) {
            throw new Error(`detector SSE 无 data：${sse.slice(0, 120)}`);
        }
        return parsed;
    }
}

/**
 * 归一化到 P(AI)：标签是 AI/机器/生成时取 prob；标签是人类时取 1-prob。
 * 概率会夹到 [0,1]，避免远端异常数字污染聚合。
 */
export function toPAi(label: string, prob: number): number {
    const normalized = clampProbability(prob);
    const isAi = /ai|机器|生成/i.test(label) && !/人|human/i.test(label);
    return isAi ? normalized : 1 - normalized;
}

/** 文档级聚合：按块可见长度加权 mean，并返回 max。 */
export function aggregate(scores: number[], chunks: Chunk[]): {docPAi: number; maxPAi: number} {
    if (scores.length === 0 || chunks.length === 0) {
        return {docPAi: 0, maxPAi: 0};
    }
    let weightSum = 0;
    let weighted = 0;
    for (let index = 0; index < scores.length; index++) {
        const chunk = chunks[index];
        const score = scores[index];
        if (!chunk || score === undefined) {
            continue;
        }
        const weight = Math.max(1, visibleLen(chunk.text));
        weighted += clampProbability(score) * weight;
        weightSum += weight;
    }
    if (weightSum === 0) {
        return {docPAi: 0, maxPAi: 0};
    }
    return {
        docPAi: weighted / weightSum,
        maxPAi: Math.max(...scores.map(clampProbability)),
    };
}

/** 检测器默认口径；CLI 和缓存键共同消费。 */
export function defaultDetectorOptions(overrides: {space?: string; chunkChars?: number; minIntervalMs?: number | null; proxy?: string | null} = {}): DetectorOptions {
    return {
        version: DEFAULT_DETECTOR_VERSION,
        endpoint: DEFAULT_DETECTOR_ENDPOINT,
        space: overrides.space ?? DEFAULT_DETECTOR_SPACE,
        chunkChars: overrides.chunkChars ?? DEFAULT_DETECTOR_CHUNK_CHARS,
        minIntervalMs: overrides.minIntervalMs ?? null,
        proxy: overrides.proxy ?? null,
    };
}

async function createRuntimeFetch(proxy: string | null): Promise<FetchLike> {
    if (!proxy) {
        return globalThis.fetch.bind(globalThis);
    }
    if (isBunRuntime()) {
        return ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, {...init, proxy} as RequestInit & {proxy: string})) as FetchLike;
    }
    const module = await import("node-fetch-native/proxy");
    return module.createFetch({url: proxy, noProxy: []}) as FetchLike;
}

function parseSse(body: string): {label: string; prob: number} | null {
    for (const line of body.split(/\r?\n/u)) {
        if (!line.startsWith("data:")) {
            continue;
        }
        try {
            const value = JSON.parse(line.slice(5).trim()) as unknown;
            if (Array.isArray(value) && value.length >= 2) {
                return {label: String(value[0]), prob: Number(value[1])};
            }
        } catch {
            // gradio SSE 可能有非 JSON 心跳行，跳过。
        }
    }
    return null;
}

function clampProbability(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}

function isBunRuntime(): boolean {
    return typeof process.versions.bun === "string";
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

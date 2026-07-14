// 外部 AIGC 检测器 client（可换接口）。首个实现 = HF yuchuantian/AIGC_text_detector（gradio Space）。
// 契约：detect(text) → 每块原始结果 + 文档级聚合（长度加权 mean 主指标 + max/p75 副）。
// 分数是**对照仪表**，不进 docScore/lift（D1/口径分离）。
import {chunkBySentence, visibleLen, type Chunk} from "./chunk";

/** 单块检测结果。pAi = P(该块是 AI)，已归一化（标签=人类时 1−prob）。 */
export type ChunkScore = {start: number; end: number; label: string; prob: number; pAi: number};

/** 文档级聚合。mean = 长度加权（整篇同源语料用它算 AUC）；max/p75 = 局部敏感（未来 web 混合来源用）。 */
export type DocAggregate = {meanPAi: number; maxPAi: number; p75PAi: number; chunkCount: number};

export type DetectResult = {chunks: ChunkScore[]; doc: DocAggregate};

/** 检测器统一接口（可换：换一个实现即换检测器）。 */
export interface DetectorClient {
    readonly name: string;
    readonly version: string;
    detect(text: string): Promise<DetectResult>;
}

export type HfDetectorOptions = {
    endpoint: string;       // gradio api_name，如 predict_zh
    version: string;        // space 不自报版本，用固定日期/revision（跨版本概率不可比）
    chunkChars: number;
    minIntervalMs: number;  // 相邻请求最小间隔（免费实例限速）
    space?: string;         // HF space 子域，默认 yuchuantian
    maxRetries?: number;
};

const DEFAULT_SPACE = "yuchuantian-aigc-text-detector.hf.space";

/**
 * HF gradio 检测器。协议（2026-07-03 实测）：
 * POST /gradio_api/call/{endpoint} {data:[text]} → {event_id} → GET .../{endpoint}/{event_id}（SSE）→ ["标签","prob"]。
 */
export class HfDetector implements DetectorClient {
    readonly name: string;
    readonly version: string;
    private readonly opts: Required<HfDetectorOptions>;
    private lastCallAt = 0;

    constructor(options: HfDetectorOptions) {
        this.opts = {space: DEFAULT_SPACE, maxRetries: 3, ...options};
        this.name = `hf:${this.opts.space.split(".")[0]}:${options.endpoint}`;
        this.version = options.version;
    }

    async detect(text: string): Promise<DetectResult> {
        const chunks = chunkBySentence(text, this.opts.chunkChars);
        const scored: ChunkScore[] = [];
        for (const chunk of chunks) {
            const {label, prob} = await this.scoreChunk(chunk.text);
            scored.push({start: chunk.start, end: chunk.end, label, prob, pAi: toPAi(label, prob)});
        }
        return {chunks: scored, doc: aggregate(scored, chunks)};
    }

    /** 单块打分：限速 + 重试（冷启动 503/网络）。 */
    private async scoreChunk(text: string): Promise<{label: string; prob: number}> {
        for (let attempt = 0; attempt < this.opts.maxRetries; attempt += 1) {
            await this.throttle();
            try {
                return await this.callGradio(text);
            } catch (error) {
                if (attempt === this.opts.maxRetries - 1) {
                    throw error;
                }
                await sleep(this.opts.minIntervalMs * 2 ** attempt); // 退避（冷启动可能要几十秒）
            }
        }
        throw new Error("unreachable");
    }

    private async throttle(): Promise<void> {
        const wait = this.lastCallAt + this.opts.minIntervalMs - Date.now();
        if (wait > 0) {
            await sleep(wait);
        }
        this.lastCallAt = Date.now();
    }

    /** 一次 gradio 调用：POST 拿 event_id → GET SSE 拿 ["标签","prob"]。 */
    private async callGradio(text: string): Promise<{label: string; prob: number}> {
        const base = `https://${this.opts.space}/gradio_api/call/${this.opts.endpoint}`;
        const post = await fetch(base, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({data: [text]}),
            signal: AbortSignal.timeout(60_000),
        });
        if (!post.ok) {
            throw new Error(`detector POST ${post.status}`);
        }
        const eventId = ((await post.json()) as {event_id?: string}).event_id;
        if (!eventId) {
            throw new Error("detector 无 event_id");
        }
        const stream = await fetch(`${base}/${eventId}`, {signal: AbortSignal.timeout(120_000)});
        const body = await stream.text();
        const parsed = parseSse(body);
        if (!parsed) {
            throw new Error(`detector SSE 无 data：${body.slice(0, 120)}`);
        }
        return parsed;
    }
}

/** 解析 gradio SSE：找 `data: ["标签","0.99"]` 那行。 */
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

/** 归一化到 P(AI)：标签是 AI → prob；标签是人类 → 1−prob。 */
function toPAi(label: string, prob: number): number {
    const isAi = /ai|机器|生成/i.test(label) && !/人|human/i.test(label);
    return isAi ? prob : 1 - prob;
}

/** 文档级聚合：长度加权 mean（主）+ max + p75（副）。 */
function aggregate(scores: ChunkScore[], chunks: Chunk[]): DocAggregate {
    if (scores.length === 0) {
        return {meanPAi: 0, maxPAi: 0, p75PAi: 0, chunkCount: 0};
    }
    let weightSum = 0;
    let weighted = 0;
    scores.forEach((s, i) => {
        const w = Math.max(1, visibleLen(chunks[i]!.text));
        weighted += s.pAi * w;
        weightSum += w;
    });
    const sorted = scores.map((s) => s.pAi).sort((a, b) => a - b);
    return {
        meanPAi: weighted / weightSum,
        maxPAi: sorted[sorted.length - 1]!,
        p75PAi: percentile(sorted, 0.75),
        chunkCount: scores.length,
    };
}

/** 已排序数组的分位数（线性插值）。 */
function percentile(sorted: number[], q: number): number {
    if (sorted.length === 1) {
        return sorted[0]!;
    }
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

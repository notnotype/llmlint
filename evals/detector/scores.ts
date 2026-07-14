// detector sidecar（evals/report/detector-scores.json）的共享契约：detect.ts 写、score.ts 读（repair before/after 对照）。
// key 算法在此单一真相源：score.ts 用同一函数按"当前正文"重算 key 查分——内容一变即查不到 = 视为未打分，
// 从根上杜绝"按文件名索引拿到陈旧分数"这类错位（原始存、派生算）。
import {createHash} from "node:crypto";
import type {ExternalDetectorSummary} from "../lib/types";
import type {ChunkScore, DocAggregate} from "./hf-client";

/** sidecar 缓存条目：一篇正文在某 detector@version+chunkChars 口径下的打分（块原始结果 + 文档级聚合）。 */
export type DetectorCacheEntry = {key: string; doc: DocAggregate; chunks: ChunkScore[]};

/** sidecar 文件形状。summary 由 detect.ts 按 reference/render 汇总写入，score.ts 原样搬进 report.externalDetector。 */
export type DetectorScoresFile = {
    detector: string;
    version: string;
    chunkChars: number;
    summary?: ExternalDetectorSummary;
    entries: Record<string, DetectorCacheEntry>;
};

/** 缓存 key = sha256(detector|version|chunkChars|正文) 截 24 位：内容或口径任一变即失效。 */
export function detectorCacheKey(detectorName: string, version: string, chunkChars: number, text: string): string {
    return createHash("sha256").update(`${detectorName}|${version}|${chunkChars}|${text}`).digest("hex").slice(0, 24);
}

import {createHash} from "node:crypto";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {userCacheDir} from "../user-state";
import type {DetectPayload, DetectorOptions} from "./transport";

export type CachedDetectRecord = {
    generatedAt: string;
    payload: DetectPayload;
};

/** 按检测器口径、space、chunkChars 与正文生成完整 SHA-256 缓存键。 */
export function detectCacheKey(content: string, options: Pick<DetectorOptions, "version" | "endpoint" | "space" | "chunkChars">): string {
    const hash = createHash("sha256");
    hash.update(options.version);
    hash.update("\0");
    hash.update(options.endpoint);
    hash.update("\0");
    hash.update(options.space);
    hash.update("\0");
    hash.update(String(options.chunkChars));
    hash.update("\0");
    hash.update(content);
    return hash.digest("hex");
}

/** 读取缓存；损坏 JSON 或形状不合法按未命中处理。 */
export function readDetectCache(key: string): DetectPayload | null {
    const filePath = cachePath(key);
    if (!existsSync(filePath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
        return isCachedRecord(parsed) ? parsed.payload : null;
    } catch {
        return null;
    }
}

/** 写入检测缓存；payload 不含当前文件路径，避免跨路径复用时污染报告。 */
export function writeDetectCache(key: string, payload: DetectPayload): void {
    const record: CachedDetectRecord = {
        generatedAt: new Date().toISOString(),
        payload,
    };
    writeFileSync(cachePath(key), `${JSON.stringify(record, null, 4)}\n`, "utf-8");
}

function cachePath(key: string): string {
    return join(userCacheDir(), `${key}.json`);
}

function isCachedRecord(value: unknown): value is CachedDetectRecord {
    if (!isObject(value) || typeof value.generatedAt !== "string" || !isDetectPayload(value.payload)) {
        return false;
    }
    return true;
}

function isDetectPayload(value: unknown): value is DetectPayload {
    if (!isObject(value) || !isObject(value.detector)) {
        return false;
    }
    if (typeof value.detector.version !== "string"
        || typeof value.detector.endpoint !== "string"
        || typeof value.detector.space !== "string"
        || typeof value.detector.chunkChars !== "number"
        || typeof value.docPAi !== "number"
        || typeof value.maxPAi !== "number"
        || !Array.isArray(value.chunks)) {
        return false;
    }
    return value.chunks.every((chunk) => isObject(chunk)
        && Array.isArray(chunk.span)
        && chunk.span.length === 2
        && typeof chunk.span[0] === "number"
        && typeof chunk.span[1] === "number"
        && typeof chunk.pAi === "number"
        && typeof chunk.line === "number");
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

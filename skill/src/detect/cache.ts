import {createHash} from "node:crypto";
import {existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {userCacheDir} from "../user-state";
import type {DetectPayload, DetectorOptions} from "./transport";

export type CachedDetectRecord = {
    generatedAt: string;
    payload: DetectPayload;
};

export type DetectCacheBudget = {
    maxAgeMs?: number;
    maxBytes?: number;
    maxEntries?: number;
    nowMs?: number;
};

export const DETECT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DETECT_CACHE_MAX_BYTES = 128 * 1024 * 1024;
export const DETECT_CACHE_MAX_ENTRIES = 1000;
const CACHE_FILE_PATTERN = /^[a-f0-9]{64}\.json$/u;

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
    pruneDetectCache();
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
    pruneDetectCache();
}

/**
 * 回收 detect 内容寻址缓存。缓存不是用户真相源，过期、超项或超字节的旧项可直接删除。
 */
export function pruneDetectCache(budget: DetectCacheBudget = {}): void {
    const directory = userCacheDir();
    const maxAgeMs = budget.maxAgeMs ?? DETECT_CACHE_MAX_AGE_MS;
    const maxBytes = budget.maxBytes ?? DETECT_CACHE_MAX_BYTES;
    const maxEntries = budget.maxEntries ?? DETECT_CACHE_MAX_ENTRIES;
    const oldestMtimeMs = (budget.nowMs ?? Date.now()) - maxAgeMs;
    const files = readdirSync(directory, {withFileTypes: true})
        .filter((entry) => entry.isFile() && CACHE_FILE_PATTERN.test(entry.name))
        .map((entry) => {
            const filePath = join(directory, entry.name);
            const stat = statSync(filePath);
            return {filePath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs};
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));

    let keptEntries = 0;
    let keptBytes = 0;
    for (const file of files) {
        const exceedsBudget = keptEntries >= Math.max(0, maxEntries)
            || keptBytes + file.size > Math.max(0, maxBytes);
        if (file.mtimeMs < oldestMtimeMs || exceedsBudget) {
            rmSync(file.filePath, {force: true});
            continue;
        }
        keptEntries += 1;
        keptBytes += file.size;
    }
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

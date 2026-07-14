import type {ReviewAnnotation} from "./review-ranges";

// v2：批注改为源锚定（Task 11）。key 按**原文**（plan.source）指纹，存 ReviewAnnotation；
// 草稿坐标不落储，恢复后由 piece-table 现算投影。v1（按草稿文本 key）数据直接废弃。
const STORAGE_KEY = "llmlint.reviewComments.v2";
const MAX_ENTRIES = 20;

type StoredReviewAnnotationEntry = {
    textKey: string;
    updatedAt: number;
    annotations: ReviewAnnotation[];
};

/**
 * 为原文生成稳定指纹，用于本地恢复 sidecar 批注。
 * 这里不写回正文，只把批注绑定到完全相同的原文内容。
 */
export function reviewCommentTextKey(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${text.length}:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * 从浏览器 localStorage 恢复某原文的批注；恢复前校验锚点区间在原文边界内。
 * quote 是建注时的选区快照（可能取自草稿），故不与原文切片比对。
 */
export function loadStoredReviewAnnotations(source: string): ReviewAnnotation[] {
    if (!import.meta.client || !source.trim()) {
        return [];
    }
    const entry = readEntries().find((item) => item.textKey === reviewCommentTextKey(source));
    if (!entry) {
        return [];
    }
    return entry.annotations.filter((annotation) => isAnnotationValidForSource(source, annotation));
}

/**
 * 保存某原文的 sidecar 批注。空批注会删除对应原文记录，避免旧批注复活。
 */
export function saveStoredReviewAnnotations(source: string, annotations: ReviewAnnotation[]): void {
    if (!import.meta.client || !source.trim()) {
        return;
    }
    const textKey = reviewCommentTextKey(source);
    const validAnnotations = annotations
        .filter((annotation) => isAnnotationValidForSource(source, annotation))
        .map((annotation) => ({...annotation}));
    const nextEntries = readEntries().filter((entry) => entry.textKey !== textKey);
    if (validAnnotations.length > 0) {
        nextEntries.unshift({
            textKey,
            updatedAt: Date.now(),
            annotations: validAnnotations,
        });
    }
    writeEntries(nextEntries
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_ENTRIES));
}

/**
 * 删除某一份原文对应的本地 sidecar 批注。
 */
export function removeStoredReviewAnnotationsForText(text: string): void {
    if (!import.meta.client || !text.trim()) {
        return;
    }
    const textKey = reviewCommentTextKey(text);
    writeEntries(readEntries().filter((entry) => entry.textKey !== textKey));
}

/**
 * 清空全部本地 sidecar 批注。
 */
export function clearStoredReviewAnnotations(): void {
    if (!import.meta.client) {
        return;
    }
    writeEntries([]);
}

function readEntries(): StoredReviewAnnotationEntry[] {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.flatMap((entry) => normalizeEntry(entry));
    } catch {
        return [];
    }
}

function writeEntries(entries: StoredReviewAnnotationEntry[]): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // localStorage quota or privacy-mode failures should not block editing.
    }
}

function normalizeEntry(value: unknown): StoredReviewAnnotationEntry[] {
    if (!isObject(value) || typeof value.textKey !== "string" || typeof value.updatedAt !== "number" || !Array.isArray(value.annotations)) {
        return [];
    }
    const annotations = value.annotations.flatMap((annotation) => normalizeAnnotation(annotation));
    return [{
        textKey: value.textKey,
        updatedAt: value.updatedAt,
        annotations,
    }];
}

function normalizeAnnotation(value: unknown): ReviewAnnotation[] {
    if (!isObject(value)
        || typeof value.id !== "string"
        || typeof value.sourceFrom !== "number"
        || typeof value.sourceTo !== "number"
        || typeof value.quote !== "string"
        || typeof value.body !== "string"
        || (value.source !== "user" && value.source !== "rule")
    ) {
        return [];
    }
    return [{
        id: value.id,
        sourceFrom: value.sourceFrom,
        sourceTo: value.sourceTo,
        quote: value.quote,
        body: value.body,
        source: value.source,
        resolved: value.resolved === true,
    }];
}

function isAnnotationValidForSource(source: string, annotation: ReviewAnnotation): boolean {
    return Number.isInteger(annotation.sourceFrom)
        && Number.isInteger(annotation.sourceTo)
        && annotation.sourceFrom >= 0
        && annotation.sourceTo >= annotation.sourceFrom
        && annotation.sourceTo <= source.length
        && annotation.quote.length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type {ReviewComment} from "./review-ranges";

const STORAGE_KEY = "llmlint.reviewComments.v1";
const MAX_ENTRIES = 20;

type StoredReviewCommentEntry = {
    textKey: string;
    updatedAt: number;
    comments: ReviewComment[];
};

/**
 * 为当前 Markdown 正文生成稳定指纹，用于本地恢复 sidecar 批注。
 * 这里不写回 Markdown，只把批注绑定到完全相同的正文内容。
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
 * 从浏览器 localStorage 恢复当前正文的批注；恢复前校验 quote 与正文片段一致。
 */
export function loadStoredReviewComments(text: string): ReviewComment[] {
    if (!import.meta.client || !text.trim()) {
        return [];
    }
    const entry = readEntries().find((item) => item.textKey === reviewCommentTextKey(text));
    if (!entry) {
        return [];
    }
    return entry.comments.filter((comment) => isCommentValidForText(text, comment));
}

/**
 * 保存当前正文的 sidecar 批注。空批注会删除对应正文记录，避免旧批注复活。
 */
export function saveStoredReviewComments(text: string, comments: ReviewComment[]): void {
    if (!import.meta.client || !text.trim()) {
        return;
    }
    const textKey = reviewCommentTextKey(text);
    const validComments = comments
        .filter((comment) => isCommentValidForText(text, comment))
        .map((comment) => ({...comment}));
    const nextEntries = readEntries().filter((entry) => entry.textKey !== textKey);
    if (validComments.length > 0) {
        nextEntries.unshift({
            textKey,
            updatedAt: Date.now(),
            comments: validComments,
        });
    }
    writeEntries(nextEntries
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_ENTRIES));
}

/**
 * 删除某一份正文对应的本地 sidecar 批注。
 */
export function removeStoredReviewCommentsForText(text: string): void {
    if (!import.meta.client || !text.trim()) {
        return;
    }
    const textKey = reviewCommentTextKey(text);
    writeEntries(readEntries().filter((entry) => entry.textKey !== textKey));
}

/**
 * 清空全部本地 sidecar 批注。
 */
export function clearStoredReviewComments(): void {
    if (!import.meta.client) {
        return;
    }
    writeEntries([]);
}

function readEntries(): StoredReviewCommentEntry[] {
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

function writeEntries(entries: StoredReviewCommentEntry[]): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // localStorage quota or privacy-mode failures should not block editing.
    }
}

function normalizeEntry(value: unknown): StoredReviewCommentEntry[] {
    if (!isObject(value) || typeof value.textKey !== "string" || typeof value.updatedAt !== "number" || !Array.isArray(value.comments)) {
        return [];
    }
    const comments = value.comments.flatMap((comment) => normalizeComment(comment));
    return [{
        textKey: value.textKey,
        updatedAt: value.updatedAt,
        comments,
    }];
}

function normalizeComment(value: unknown): ReviewComment[] {
    if (!isObject(value)
        || typeof value.id !== "string"
        || typeof value.from !== "number"
        || typeof value.to !== "number"
        || typeof value.quote !== "string"
        || typeof value.body !== "string"
        || (value.source !== "user" && value.source !== "rule")
    ) {
        return [];
    }
    return [{
        id: value.id,
        from: value.from,
        to: value.to,
        quote: value.quote,
        body: value.body,
        source: value.source,
        resolved: value.resolved === true,
    }];
}

function isCommentValidForText(text: string, comment: ReviewComment): boolean {
    return Number.isInteger(comment.from)
        && Number.isInteger(comment.to)
        && comment.from >= 0
        && comment.to > comment.from
        && comment.to <= text.length
        && comment.quote.length > 0
        && text.slice(comment.from, comment.to) === comment.quote;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

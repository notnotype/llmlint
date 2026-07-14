import {watch} from "vue";
import {clearStoredReviewAnnotations, removeStoredReviewAnnotationsForText} from "../utils/review-comment-storage";

export interface RecentScan {
    id: string;
    text: string;
    title: string;
    charCount: number;
    issueCount: number;
    timestamp: number;
    scores: {
        aiFlavor: number | null;     // 1-5 分
        wantReadOn: number | null;   // 1-5 分
    };
}

const STORAGE_KEY = "llmlint.recentScans.v1";
const MAX_SCANS = 5;

function readRecentScans(): RecentScan[] {
    if (!import.meta.client) {
        return [];
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.flatMap((item) => normalizeRecentScan(item)).slice(0, MAX_SCANS);
    } catch {
        return [];
    }
}

function writeRecentScans(nextScans: RecentScan[]): void {
    if (!import.meta.client) {
        return;
    }
    const remaining = nextScans.slice(0, MAX_SCANS);
    while (remaining.length > 0) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
            return;
        } catch {
            const largestIndex = remaining.reduce((largest, item, index, items) => (
                item.text.length > items[largest]!.text.length ? index : largest
            ), 0);
            remaining.splice(largestIndex, 1);
        }
    }
    try {
        window.localStorage.setItem(STORAGE_KEY, "[]");
    } catch {
        // localStorage quota or privacy-mode failures should not block the editor.
    }
}

function normalizeRecentScan(value: unknown): RecentScan[] {
    if (!isObject(value)
        || typeof value.id !== "string"
        || typeof value.text !== "string"
        || typeof value.title !== "string"
        || typeof value.charCount !== "number"
        || typeof value.issueCount !== "number"
        || typeof value.timestamp !== "number"
        || !isObject(value.scores)
    ) {
        return [];
    }
    if (value.charCount !== value.text.length) {
        return [];
    }
    const aiFlavor = typeof value.scores.aiFlavor === "number" ? value.scores.aiFlavor : null;
    const wantReadOn = typeof value.scores.wantReadOn === "number" ? value.scores.wantReadOn : null;
    return [{
        id: value.id,
        text: value.text,
        title: value.title,
        charCount: value.charCount,
        issueCount: value.issueCount,
        timestamp: value.timestamp,
        scores: {aiFlavor, wantReadOn},
    }];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function useRecentScans() {
    const scans = useState<RecentScan[]>("llmlint-recent-scans", () => readRecentScans());

    if (import.meta.client) {
        watch(scans, (nextScans) => {
            writeRecentScans(nextScans);
        }, {deep: true});
    }

    /**
     * 新增一条历史记录。如果有内容相似的记录，则去重并置顶。
     */
    function addScan(fullText: string, issueCount: number): void {
        if (!fullText.trim()) {
            return;
        }
        const textToSave = fullText;
        const charCount = fullText.length;
        
        // 生成标题：取首行非空的前 40 字
        const lines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        let title = lines[0] || "未命名文本";
        if (title.length > 40) {
            title = title.slice(0, 40) + "...";
        }

        const next = [...scans.value];
        // 简单去重：如果内容前 500 字一致且长度一致，认为是同一篇文章
        const dupIndex = next.findIndex(
            (item) => item.charCount === charCount && item.text.slice(0, 500) === textToSave.slice(0, 500)
        );

        let existingScores: RecentScan["scores"] = {aiFlavor: null, wantReadOn: null};
        if (dupIndex >= 0) {
            existingScores = next[dupIndex]!.scores;
            next.splice(dupIndex, 1);
        }

        const newScan: RecentScan = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            text: textToSave,
            title,
            charCount,
            issueCount,
            timestamp: Date.now(),
            scores: existingScores,
        };

        next.unshift(newScan);
        scans.value = next.slice(0, MAX_SCANS);
    }

    /**
     * 更新某条记录的打评分数。
     */
    function updateScores(id: string, partialScores: Partial<RecentScan["scores"]>): void {
        const next = scans.value.map((item) => {
            if (item.id === id) {
                return {
                    ...item,
                    scores: {
                        ...item.scores,
                        ...partialScores,
                    },
                };
            }
            return item;
        });
        scans.value = next;
    }

    /**
     * 删除单条历史记录。
     */
    function removeScan(id: string): void {
        const scan = scans.value.find((item) => item.id === id);
        if (scan) {
            removeStoredReviewAnnotationsForText(scan.text);
        }
        scans.value = scans.value.filter((item) => item.id !== id);
    }

    /**
     * 清空全部历史。
     */
    function clearScans(): void {
        clearStoredReviewAnnotations();
        scans.value = [];
    }

    return {
        scans,
        addScan,
        updateScores,
        removeScan,
        clearScans,
    };
}

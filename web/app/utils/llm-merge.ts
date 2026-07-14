// LLM 整篇改写结果的 diff 细化（Task 13 W7 F1）：把「当前草稿 → AI 改写稿」的整篇差异
// 拆成一处处替换 hunk，供编辑面逐 hunk 并入 piece-table（每处成为独立 llm 编辑，可单独巡检/拒绝）。
// 背景：deriveDiffs 是一条 edit 映射一条 diff、无内部细化——整篇结果若单条 splice 并入只会出
// 一条巨型 diff，逐处审阅落空（W7 规格「复用盘点」⚠注）。
//
// 底层用 diff-match-patch（dmp）：diff_main 产出 EQUAL/DELETE/INSERT 段序列，
// diff_cleanupSemantic 把字符级碎片聚成语义块（即用户眼中的「一处改动」）。
// dmp 的 diff 单位是 UTF-16 码元，与 piece-table / SpanAnnotation 同一坐标系，无需换算。
// 已知边界：当改动落在同高位代理的 emoji 之间时，dmp 可能在代理对内部切分（hunk 文本含
// 孤立代理项，diff 标签渲染略丑）；码元级拼接不受影响，最终文本始终精确等于改写稿。

import DiffMatchPatch from "diff-match-patch";

/** 一处改写 hunk：把 base 的 [from, to)（UTF-16 码元半开区间）替换为 replacement。 */
export type LlmHunk = {
    from: number;
    to: number;
    replacement: string;
};

/** dmp 超时（秒）：超时后 diff 退化为更粗的块（正确性不受影响，仅粒度变粗），防长文爆炸。 */
const DIFF_TIMEOUT_SECONDS = 1;

/**
 * 计算「base → rewritten」的替换 hunk 列表（生产入口，TextPanel.applyLlmRewrite 消费）。
 *
 * 保证（无论 diff 粒度如何）：
 * - hunk 按 from 升序、互不重叠，相邻 hunk 之间必隔非空 EQUAL 段；
 * - 每个 hunk 都是真实变更（非零宽删除或非空插入）；
 * - 对 base 逐 hunk **从后往前**应用（后方替换不影响前方坐标）=== rewritten；
 * - base === rewritten 时返回空数组。
 */
export function computeLlmHunks(base: string, rewritten: string): LlmHunk[] {
    return computeLlmHunksWithTimeout(base, rewritten, DIFF_TIMEOUT_SECONDS);
}

/**
 * 同 computeLlmHunks，但可注入 dmp 超时秒数——供测试验证「超时兜底出粗块」路径；
 * 生产一律走 computeLlmHunks（固定默认超时）。
 */
export function computeLlmHunksWithTimeout(base: string, rewritten: string, timeoutSeconds: number): LlmHunk[] {
    if (base === rewritten) {
        return [];
    }
    const dmp = new DiffMatchPatch();
    // Diff_Timeout 单位为秒；超时后 dmp 返回合法但更粗的 diff（不会破坏拼接不变量）。
    dmp.Diff_Timeout = timeoutSeconds;
    const diffs = dmp.diff_main(base, rewritten);
    dmp.diff_cleanupSemantic(diffs);

    // 折叠：连续的 DELETE/INSERT 段归入同一替换 hunk；EQUAL 段推进 base 光标并封口当前 hunk。
    // 常量取自类静态（DIFF_DELETE=-1 / DIFF_EQUAL=0 / DIFF_INSERT=1），与运行时导出一致。
    const hunks: LlmHunk[] = [];
    let cursor = 0;
    let pending: LlmHunk | null = null;
    for (const [op, segment] of diffs) {
        if (op === DiffMatchPatch.DIFF_EQUAL) {
            // 空 EQUAL 段（理论上被 dmp cleanupMerge 清除）不封口，防止产出零间隔的相邻 hunk。
            if (segment.length === 0) {
                continue;
            }
            if (pending) {
                hunks.push(pending);
                pending = null;
            }
            cursor += segment.length;
            continue;
        }
        pending ??= {from: cursor, to: cursor, replacement: ""};
        if (op === DiffMatchPatch.DIFF_DELETE) {
            cursor += segment.length;
            pending.to = cursor;
        } else {
            pending.replacement += segment;
        }
    }
    if (pending) {
        hunks.push(pending);
    }
    return hunks;
}

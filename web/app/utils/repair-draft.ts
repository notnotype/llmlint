// 修复草稿（repair draft）纯核心：分层派生模型的算法心脏，无 Vue 依赖，可独立测试。
//
// 领域模型（见 CONTEXT.md §2.6 与 Task 09）：
//   - source（原文）不可变。
//   - edits：一组**锚定原文坐标**的编辑 {sourceFrom, sourceTo, replacement, provenance}，
//     排序、互不重叠（invariant）。这就是 piece-table。
//   - draft（修复草稿）= fold(source, edits) 派生得到；diff 也全部从 edits 派生。
//
// 于是命令式 diffs 数组 + 每次改文的 transform* 位置搬运机制被彻底消除：
// 文本变动只需把「draft 坐标的一次 splice」并入 edits 表，其余全靠 fold 现算。
//
// 唯一的难点是 draft 坐标 → 原文坐标的映射（改到「已改过区域」要合并），
// 在 applyDraftSplice 里用「吸收重叠 edit + 用新草稿内容重算合并替换」一次性解决。

/** 编辑来源：静态规则 / LLM 改写 / 用户手改。用于 diff 着色与 per-rule 溯源。 */
export type RepairEditKind = "static" | "llm" | "user";

/** 一条锚定原文坐标的编辑。sourceFrom/sourceTo 为原文 UTF-16 半开区间。 */
export type RepairEdit = {
    id: string;
    sourceFrom: number;
    sourceTo: number;
    replacement: string;
    kind: RepairEditKind;
    title: string;
    /** 静态编辑携带触发规则 id；其余来源为空。 */
    ruleId?: string;
};

/** 修复计划：原文 + 排序且互不重叠的源锚定编辑表。外部只读，一切变更返回新计划。 */
export type RepairPlan = {
    source: string;
    edits: RepairEdit[];
};

/** 派生出的一处差异（draft 坐标），供高亮 / 导航 / 逐条 reject。 */
export type RepairDiff = {
    id: string;
    from: number;
    to: number;
    deleted: string;
    inserted: string;
    kind: RepairEditKind;
    title: string;
    ruleId?: string;
};

/** 编辑元数据：applyDraftSplice / applySourceEdit 写入新编辑时携带。 */
export type RepairEditMeta = {
    id: string;
    kind: RepairEditKind;
    title: string;
    ruleId?: string;
};

/** 用原文建一个空计划（尚无任何编辑，draft === source）。 */
export function createPlan(source: string): RepairPlan {
    return {source, edits: []};
}

type Segment = {
    kind: "source" | "edit";
    sourceStart: number;
    sourceEnd: number;
    draftStart: number;
    draftEnd: number;
    edit?: RepairEdit;
};

/**
 * 把计划展开成 draft 上的分段序列：source 段与 edit 段交替。
 * 是映射与派生的公共底座；要求 edits 已排序、互不重叠。
 */
function buildSegments(plan: RepairPlan): Segment[] {
    const {source, edits} = plan;
    const segments: Segment[] = [];
    let sourceCursor = 0;
    let draftCursor = 0;
    for (const edit of edits) {
        if (edit.sourceFrom > sourceCursor) {
            const length = edit.sourceFrom - sourceCursor;
            segments.push({kind: "source", sourceStart: sourceCursor, sourceEnd: edit.sourceFrom, draftStart: draftCursor, draftEnd: draftCursor + length});
            draftCursor += length;
        }
        const replacementLength = edit.replacement.length;
        segments.push({kind: "edit", sourceStart: edit.sourceFrom, sourceEnd: edit.sourceTo, draftStart: draftCursor, draftEnd: draftCursor + replacementLength, edit});
        draftCursor += replacementLength;
        sourceCursor = edit.sourceTo;
    }
    if (sourceCursor < source.length) {
        const length = source.length - sourceCursor;
        segments.push({kind: "source", sourceStart: sourceCursor, sourceEnd: source.length, draftStart: draftCursor, draftEnd: draftCursor + length});
    }
    return segments;
}

/** 派生草稿全文。 */
export function foldDraft(plan: RepairPlan): string {
    let draft = "";
    let cursor = 0;
    for (const edit of plan.edits) {
        draft += plan.source.slice(cursor, edit.sourceFrom);
        draft += edit.replacement;
        cursor = edit.sourceTo;
    }
    draft += plan.source.slice(cursor);
    return draft;
}

/** 派生 diff 列表（每条 edit 一处，draft 坐标，带 provenance）。 */
export function deriveDiffs(plan: RepairPlan): RepairDiff[] {
    const diffs: RepairDiff[] = [];
    for (const segment of buildSegments(plan)) {
        if (segment.kind === "edit" && segment.edit) {
            diffs.push({
                id: segment.edit.id,
                from: segment.draftStart,
                to: segment.draftEnd,
                deleted: plan.source.slice(segment.edit.sourceFrom, segment.edit.sourceTo),
                inserted: segment.edit.replacement,
                kind: segment.edit.kind,
                title: segment.edit.title,
                ruleId: segment.edit.ruleId,
            });
        }
    }
    return diffs;
}

/**
 * 原文坐标 → draft 坐标。累加所有「整体位于该位置左侧」（sourceTo <= sourcePos）的 edit 造成的长度差，
 * 在所有 edit 边界处精确。（位置严格落在某 edit 原文区间内部时给出左偏近似，但实际只在边界处调用。）
 */
export function sourceToDraft(plan: RepairPlan, sourcePos: number): number {
    let delta = 0;
    for (const edit of plan.edits) {
        if (edit.sourceTo <= sourcePos) {
            delta += edit.replacement.length - (edit.sourceTo - edit.sourceFrom);
        }
    }
    return sourcePos + delta;
}

/**
 * draft 坐标 → 原文坐标。source 段内精确；edit 段内按 bias 贴边
 * （left→该 edit 的 sourceFrom，right→sourceTo）。
 * 边界归属：left 取最先命中的段（偏左），right 取最后命中的段（偏右），
 * 使 splice 边界「宁可略宽」——多吸收的 edit 会在合并时重算、不出错；漏吸收才会错。
 */
function draftToSourceBiased(plan: RepairPlan, draftPos: number, bias: "left" | "right"): number {
    const segments = buildSegments(plan);
    let lastMatch: number | null = null;
    for (const segment of segments) {
        if (draftPos >= segment.draftStart && draftPos <= segment.draftEnd) {
            const value = segment.kind === "source"
                ? segment.sourceStart + (draftPos - segment.draftStart)
                : (bias === "left" ? segment.sourceStart : segment.sourceEnd);
            if (bias === "left") {
                return value;
            }
            lastMatch = value;
        }
    }
    if (lastMatch !== null) {
        return lastMatch;
    }
    const tail = segments.at(-1);
    return tail ? tail.sourceEnd : draftPos;
}

/** draft 坐标 → 原文坐标（source 段精确；edit 段贴左边）。 */
export function draftToSource(plan: RepairPlan, draftPos: number): number {
    return draftToSourceBiased(plan, draftPos, "left");
}

/**
 * 在 draft 坐标上应用一次 splice：把 [draftFrom, draftTo) 替换为 newText，返回新计划。
 *
 * 算法：
 * 1. 把 [draftFrom, draftTo) 边界映射回原文，得受影响原文区间 [sourceFrom, sourceTo)。
 * 2. 吸收所有与该区间重叠的既有 edit（区间随之外扩到覆盖它们）。
 * 3. 合并替换 = 新草稿在受影响区间投影内的内容
 *    = 旧草稿[dA, draftFrom) + newText + 旧草稿[draftTo, dB)。
 * 4. 若合并结果 === 原文该段（改回原样）→ 不产生 edit（该处回到原文）。
 *
 * 这样「改到已改过区域」被正确合并成单条源锚定 edit，无需任何位置搬运。
 */
export function applyDraftSplice(plan: RepairPlan, draftFrom: number, draftTo: number, newText: string, meta: RepairEditMeta): RepairPlan {
    const oldDraft = foldDraft(plan);
    // 每条 edit 的 draft 投影区间。按 draft 空间判吸收——源空间无法识别「零宽源插入」（末尾追加等）
    // 落在 splice 区间内的情形。
    const editDraftRanges = new Map<RepairEdit, [number, number]>();
    for (const segment of buildSegments(plan)) {
        if (segment.kind === "edit" && segment.edit) {
            editDraftRanges.set(segment.edit, [segment.draftStart, segment.draftEnd]);
        }
    }

    let sourceFrom = draftToSourceBiased(plan, draftFrom, "left");
    let sourceTo = draftToSourceBiased(plan, draftTo, "right");

    const kept: RepairEdit[] = [];
    for (const edit of plan.edits) {
        const range = editDraftRanges.get(edit);
        // draft 投影与 splice 区间「严格」相交即吸收（既抓零宽插入，又不误并仅相邻的编辑）。
        if (range && range[0] < draftTo && range[1] > draftFrom) {
            sourceFrom = Math.min(sourceFrom, edit.sourceFrom);
            sourceTo = Math.max(sourceTo, edit.sourceTo);
        } else {
            kept.push(edit);
        }
    }

    const draftStart = sourceToDraft(plan, sourceFrom);
    const draftEnd = sourceToDraft(plan, sourceTo);
    const merged = oldDraft.slice(draftStart, draftFrom) + newText + oldDraft.slice(draftTo, draftEnd);

    const nextEdits = [...kept];
    if (merged !== plan.source.slice(sourceFrom, sourceTo)) {
        nextEdits.push({id: meta.id, sourceFrom, sourceTo, replacement: merged, kind: meta.kind, title: meta.title, ruleId: meta.ruleId});
    }
    nextEdits.sort((left, right) => left.sourceFrom - right.sourceFrom);
    return {source: plan.source, edits: nextEdits};
}

/**
 * 在原文坐标上应用一条编辑（如「接受某命中的替换」，命中位置本就是原文坐标）。
 * 走 draft splice 的同一条合并路径，保证语义一致。
 */
export function applySourceEdit(plan: RepairPlan, sourceFrom: number, sourceTo: number, replacement: string, meta: RepairEditMeta): RepairPlan {
    const draftFrom = sourceToDraft(plan, sourceFrom);
    const draftTo = sourceToDraft(plan, sourceTo);
    return applyDraftSplice(plan, draftFrom, draftTo, replacement, meta);
}

/** 移除一条编辑（逐条 reject / 撤销单处），该处回到原文。 */
export function removeEdit(plan: RepairPlan, editId: string): RepairPlan {
    return {source: plan.source, edits: plan.edits.filter((edit) => edit.id !== editId)};
}

/** 清空所有编辑，draft 回到原文。 */
export function clearEdits(plan: RepairPlan): RepairPlan {
    return {source: plan.source, edits: []};
}

/**
 * 求两串之间的最小单区间变更（去掉公共前后缀），返回 before 上的 [from, to) 与插入串。
 * 供 textarea 整串回传时把「新草稿」折算成一次 draft splice。
 * 多处分散改动会被收敛成一个覆盖区间——由 applyDraftSplice 合并重算，语义仍正确。
 */
export function locateMinimalSplice(before: string, after: string): {from: number; to: number; inserted: string} {
    let start = 0;
    const shared = Math.min(before.length, after.length);
    while (start < shared && before[start] === after[start]) {
        start++;
    }
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }
    return {from: start, to: endBefore, inserted: after.slice(start, endAfter)};
}

// —— 源锚定批注（review annotation）——
//
// 批注锚在**不可变原文坐标**上，草稿坐标一律由 plan 现算派生——与 diff 同一套映射。
// 编辑器里不存在第二套坐标系：任何文本变动都无需搬运批注位置。
//
// 语义：批注标记的是「原文的某一段」。原文不可变，故锚点天然稳定；当某条 edit 落在批注锚定
// 区间内（该段在草稿里已被改写），投影为 stale，供 UI 提示「你标注的原句已改动」。

/** 源锚定批注：锚点是不可变原文坐标；草稿坐标按需派生。 */
export type RepairAnnotation = {
    id: string;
    sourceFrom: number;
    sourceTo: number;
    body: string;
    /** 建注时选中文本的快照（可能取自草稿）；仅用于显示，不参与坐标运算。 */
    quote: string;
    resolved: boolean;
};

/**
 * 某原文区间是否被任一 edit 改动。
 * 非零宽两两之间取严格相交；零宽参与时取「严格落在对方内部 / 零宽重合」——
 * 纯插入 edit 恰在批注边界外贴着，或批注点恰在 edit 边界上，都不算改动；
 * 而「批注圈住的是某条纯插入的文本」（两者锚点重合的零宽区间）算改动。
 */
function isSourceSpanEdited(plan: RepairPlan, sourceFrom: number, sourceTo: number): boolean {
    return plan.edits.some((edit) => {
        if (sourceFrom === sourceTo && edit.sourceFrom === edit.sourceTo) {
            return sourceFrom === edit.sourceFrom;
        }
        return edit.sourceFrom < sourceTo && edit.sourceTo > sourceFrom;
    });
}

/**
 * 草稿坐标 → 原文锚点坐标（**紧贴**版，专供批注锚定）。
 * 与 draftToSource 的「宁可略宽」不同：此处求覆盖草稿选区的**最小**原文区间——
 * source 段内精确；edit 段内 snap 到该 edit 的整段原文区间（改写文本无法再细分回原文坐标）；
 * 段边界处 start 端取右侧段起点、end 端取左侧段终点，避免误吞相邻 edit。
 */
function draftOffsetToSourceAnchor(plan: RepairPlan, draftPos: number, endpoint: "start" | "end"): number {
    const segments = buildSegments(plan);
    for (const segment of segments) {
        const inside = endpoint === "start"
            ? draftPos >= segment.draftStart && draftPos < segment.draftEnd
            : draftPos > segment.draftStart && draftPos <= segment.draftEnd;
        if (!inside) {
            continue;
        }
        if (segment.kind === "source") {
            return segment.sourceStart + (draftPos - segment.draftStart);
        }
        return endpoint === "start" ? segment.sourceStart : segment.sourceEnd;
    }
    const tail = segments.at(-1);
    return tail ? tail.sourceEnd : draftPos;
}

/**
 * 由草稿选区反推原文锚点：得覆盖该草稿选区的最小原文区间。
 * 供「在改后文本上新建批注」——批注最终仍锚回原文坐标，随后靠 projectAnnotation 现算草稿坐标。
 */
export function annotationAnchorFromDraft(plan: RepairPlan, draftFrom: number, draftTo: number): {sourceFrom: number; sourceTo: number} {
    const lo = Math.min(draftFrom, draftTo);
    const hi = Math.max(draftFrom, draftTo);
    const sourceFrom = draftOffsetToSourceAnchor(plan, lo, "start");
    const sourceTo = draftOffsetToSourceAnchor(plan, hi, "end");
    return {sourceFrom, sourceTo: Math.max(sourceFrom, sourceTo)};
}

/**
 * 原文坐标 → draft 坐标（批注**终点**专用）：恰在终点上的零宽插入不计入位移，
 * 投影终点落在插入文本之前——不把紧贴批注右边界的新增内容吞进高亮。
 * （起点用 sourceToDraft：恰在起点上的插入被跳过，同理不吞左边界的新增内容。）
 */
function sourceToDraftForAnnotationEnd(plan: RepairPlan, sourcePos: number): number {
    let delta = 0;
    for (const edit of plan.edits) {
        if (edit.sourceTo > sourcePos || (edit.sourceFrom === edit.sourceTo && edit.sourceTo === sourcePos)) {
            continue;
        }
        delta += edit.replacement.length - (edit.sourceTo - edit.sourceFrom);
    }
    return sourcePos + delta;
}

/** 把一条源锚定批注投影到当前草稿坐标，并判 stale。泛型：批注携带的领域字段（provenance 等）原样透传。 */
export function projectAnnotation<T extends RepairAnnotation>(plan: RepairPlan, annotation: T): T & {from: number; to: number; stale: boolean} {
    const stale = isSourceSpanEdited(plan, annotation.sourceFrom, annotation.sourceTo);
    // 零宽批注与某条纯插入重合：批注圈的就是这段新增文本，投影覆盖其替换内容。
    if (annotation.sourceFrom === annotation.sourceTo) {
        const insertion = buildSegments(plan).find((segment) => segment.kind === "edit"
            && segment.sourceStart === segment.sourceEnd
            && segment.sourceStart === annotation.sourceFrom);
        if (insertion) {
            return {...annotation, from: insertion.draftStart, to: insertion.draftEnd, stale};
        }
    }
    const from = sourceToDraft(plan, annotation.sourceFrom);
    const to = sourceToDraftForAnnotationEnd(plan, annotation.sourceTo);
    return {...annotation, from, to: Math.max(from, to), stale};
}

/** 批量投影，按草稿起点排序，供渲染。 */
export function projectAnnotations<T extends RepairAnnotation>(plan: RepairPlan, annotations: T[]): Array<T & {from: number; to: number; stale: boolean}> {
    return annotations
        .map((annotation) => projectAnnotation(plan, annotation))
        .sort((left, right) => left.from - right.from || left.to - right.to);
}

// —— 检测热力块投影（Task 16 R6）——

/** 投影到草稿坐标后的热力块（from/to 为草稿 UTF-16 半开区间）。 */
export type ProjectedHeatChunk = {from: number; to: number; pAi: number};

/**
 * 原文坐标 → 草稿坐标（热力块端点专用）：edit 边界处与 sourceToDraft 等价；端点严格落在某
 * edit 的原文区间**内部**时，贴到该 edit 草稿段内（段起点 + 偏移量，截断到替换长度）——
 * 这样落在整段删除内的端点收敛到删除点（整块被删的 chunk 投影为空区间可剔除），
 * 而 sourceToDraft 的左偏近似会把这类端点映射出界。
 */
function sourceToDraftClamped(plan: RepairPlan, sourcePos: number): number {
    let delta = 0;
    for (const edit of plan.edits) {
        if (edit.sourceTo <= sourcePos) {
            delta += edit.replacement.length - (edit.sourceTo - edit.sourceFrom);
            continue;
        }
        if (edit.sourceFrom < sourcePos) {
            const offset = Math.min(sourcePos - edit.sourceFrom, edit.replacement.length);
            return edit.sourceFrom + delta + offset;
        }
    }
    return sourcePos + delta;
}

/**
 * 把检测器热力块投影到当前草稿坐标（Task 16 R6「热力图进编辑器」）。
 *
 * 坐标口径：chunks 的 start/end 锚定 plan.source（= head.body，检测发生时的版本正文），
 * 逐块映射为草稿坐标——块位置随 piece-table 编辑自动跟随（左侧编辑平移、块内删除收缩）；
 * 投影后 from >= to 的空块（整块内容已被删除）剔除。
 * 注意：pAi 数值仍锚定 head 检测结果，编辑后数值渐陈旧属预期（重新检测才刷新）。
 */
export function projectHeatChunks(plan: RepairPlan, chunks: Array<{start: number; end: number; pAi: number}>): ProjectedHeatChunk[] {
    const projected: ProjectedHeatChunk[] = [];
    for (const chunk of chunks) {
        const from = sourceToDraftClamped(plan, chunk.start);
        const to = sourceToDraftClamped(plan, chunk.end);
        if (from >= to) {
            continue;
        }
        projected.push({from, to, pAi: chunk.pAi});
    }
    return projected;
}

// —— 修订边分类（transition kind）——

/** 客户端可提交的修订边三值（upload 边只由服务器给 rev0 产生）。 */
export type ClientTransitionKind = "static_fix" | "llm_fix" | "user_fix";

/**
 * 按「改动内容的来源」对一轮修订分类（Task 13 W7，对齐 Task 12 语义：llm_fix=纯 AI 内容档、
 * user_fix=人类含 AI 辅助档、static_fix=全确定性静态替换档）。优先级 user > llm > static：
 * 出现任何 user 手改 ⇒ user_fix；否则出现 llm ⇒ llm_fix（static+llm 混合也算——内容全为
 * 机器产物且 llm 参与）；全 static ⇒ static_fix。「拒绝」某处 llm 修改只是移除该编辑（回原文），
 * 不产生新内容，天然不影响剩余编辑的判定；人的审阅监督由通道属性承载，不用 kind 编码。
 * 拿不到编辑面状态（null/undefined）或没有任何编辑时，保守按 user_fix（误判方向只会 llm/static→user）。
 */
export function classifyTransitionKind(kinds: RepairEditKind[] | null | undefined): ClientTransitionKind {
    if (!kinds || kinds.length === 0) {
        return "user_fix";
    }
    if (kinds.includes("user")) {
        return "user_fix";
    }
    if (kinds.includes("llm")) {
        return "llm_fix";
    }
    return "static_fix";
}

// Revision.provenanceJson 的逐 hunk 规范（Task 13 W4 建，W7 返工后唯一写入方是 app 侧 contribute 提交）。
// 类型放 shared 供前后端共读；服务端 DTO 只校验尺寸上限、不解析语义（CreateRevisionDtoSchema.provenanceJson max 200k）。
//
// 粒度纪律：以编辑面现有信息为限，拿不到的不编造——
// - 静态替换（接受命中 / 机械清理逐条应用）携带 ruleId → 逐规则计数；
// - Markdown 格式化等确定性变换是 static 但无单一规则 → 只记 kind + count；
// - 手打（user）与 LLM 改写并入（AI 改写 diff / 剪贴板整段替换）只有来源与处数可知 → 只记 kind + count。
// W7 注记：llm_fix 产出不落库后服务端不再写 provenance，model/promptVersion 暂无写入方
// （仅服务端日志可查；是否随提交持久化待拍板，见 Task 13 TODO）。

/** 一条聚合后的改动来源条目。 */
export type RevisionProvenanceEdit = {
    /** 改动来源：static=确定性替换（规则替换/机械清理/格式化）；user=手打；llm=LLM 改写（剪贴板整段替换或服务端 llm_fix） */
    kind: "static" | "user" | "llm";
    /** 触发规则 id；仅 kind=static 且来自单条规则替换时非空（格式化等无规则的 static 缺省） */
    ruleId?: string;
    /** 该 (kind, ruleId?) 组合聚合后的编辑处数；服务端 llm_fix 整篇一条时缺省 */
    count?: number;
};

/** provenanceJson 反序列化后的结构。version 固定 1；改结构必须升版本（跨版本数据不可混读）。 */
export type RevisionProvenance = {
    version: 1;
    edits: RevisionProvenanceEdit[];
    /** 人读摘要（可选，当前无写入方；预留给导入脚本等） */
    summary?: string;
    /** LLM 改写的模型 key（provider/model）。W7 后无写入方恒空（是否随提交持久化待拍板） */
    model?: string;
    /** LLM 改写的 prompt 版本（I8 版本化资产）。W7 后无写入方恒空（同上待拍板） */
    promptVersion?: string;
};

/**
 * 把编辑面的原始编辑列表（piece-table plan 投影）聚合成 provenance 条目：
 * static+ruleId 按规则聚合计数；其余按 kind 聚合计数。顺序稳定（static 按 ruleId 字典序在前）。
 */
export function aggregateProvenanceEdits(edits: Array<{kind: "static" | "user" | "llm"; ruleId?: string}>): RevisionProvenanceEdit[] {
    const counts = new Map<string, RevisionProvenanceEdit>();
    for (const edit of edits) {
        const key = edit.kind === "static" && edit.ruleId ? `static:${edit.ruleId}` : edit.kind;
        const bucket = counts.get(key);
        if (bucket) {
            bucket.count = (bucket.count ?? 0) + 1;
        } else {
            counts.set(key, {kind: edit.kind, ...(edit.kind === "static" && edit.ruleId ? {ruleId: edit.ruleId} : {}), count: 1});
        }
    }
    return [...counts.values()].sort((left, right) => (left.ruleId ?? "").localeCompare(right.ruleId ?? "") || left.kind.localeCompare(right.kind));
}

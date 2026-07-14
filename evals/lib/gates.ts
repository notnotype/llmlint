// lift 闸门谓词（CONTEXT.md D1 + I5；Task 12「闸门（D1 的升级形态）」表的代码化）。
// 本文件是 evals 侧 lift/AUC/检测器训练准入的唯一判断出口：消费点（metrics 等）必须显式调用这里的谓词，
// 不再各自用 role 比较隐式过滤——防实现者绕过闸门或改错口径。
// web 侧同一规则实现在 web/server/utils/gates.ts（类型用 prisma 生成类型），两侧必须保持对齐。
import type {SampleRole} from "./types";

/** 统一数据模型的文本来源三变体（= web `Text.originKind` 的字符串口径；evals 侧不依赖 prisma 生成类型）。 */
export type OriginKindKey = "uploaded" | "curated" | "generated";

/**
 * corpus 侧口径：按样本 role 判 lift 准入。
 * - `reference`（人类类）/ `render`（AI 类）→ true：角色即 ground-truth 标签（I5）。
 * - `repair` → false：repair 是 llmlint 洗稿产物，只进 before/after 单独统计（computeRepairStat），
 *   混进判别 = 让规则库评价自己的修复效果，lift 失去意义（I5/D1）。
 */
export function liftAdmissibleRole(role: SampleRole): boolean {
    return role === "reference" || role === "render";
}

/**
 * 统一模型口径：按 (originKind, ordinal) 判 lift 准入（Task 12 闸门表 + revision 维度）。
 * - `originKind ∈ {curated, generated}`：来源即真值（curated⇒human、generated⇒该 modelKey）；
 *   `uploaded` 自述不可信，永不进 lift（D1）。
 * - `ordinal === 0`：只有 rev0 保有 originKind 的 ground-truth 语义。rev_k(k≥1) 是改写后继
 *   （static/llm/user fix 产物，≙ corpus 侧的 repair role），provenance 已是人机混合体，不进 lift。
 *   这是文档闸门表容易漏掉的 revision 维度——双侧实现都必须带上。
 */
export function liftAdmissibleOrigin(input: {originKind: OriginKindKey; ordinal: number}): boolean {
    return (input.originKind === "curated" || input.originKind === "generated") && input.ordinal === 0;
}

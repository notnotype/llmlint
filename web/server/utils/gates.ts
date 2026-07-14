// lift 闸门（web 侧；Task 12「闸门（D1 的升级形态）」表 + CONTEXT.md D1/I5 的代码化）。
// 与 evals/lib/gates.ts 的 liftAdmissibleOrigin 同一规则，两侧必须保持对齐；
// 类型用 prisma 生成类型，export 等服务端消费点显式调用本谓词输出准入标记，下游过滤有据。
import type {OriginKind} from "../database/prisma";

/**
 * 按 (originKind, ordinal) 判 lift / 检测器训练 / task profile 准入：
 * - `originKind ∈ {curated, generated}`：来源即真值（curated⇒human、generated⇒modelKey）；
 *   `uploaded` 自述不可信，永不进 lift（D1）。
 * - `ordinal === 0`：只有 rev0 保有 originKind 的 ground-truth 语义。rev_k(k≥1) 是改写后继
 *   （static/llm/user fix 产物，≙ corpus 侧 repair role），provenance 已是人机混合体，不进 lift——
 *   这是文档闸门表容易漏掉的 revision 维度。
 */
export function liftAdmissible(input: {originKind: OriginKind; ordinal: number}): boolean {
    return (input.originKind === "curated" || input.originKind === "generated") && input.ordinal === 0;
}

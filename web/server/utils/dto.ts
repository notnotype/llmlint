import type {H3Event} from "h3";
import {readBody} from "h3";
import {z} from "zod";
// taxonomy 白名单单源在 evals/lib/taxonomy.ts（nuxt alias `evals` → ../evals/lib，nitro 侧同样生效）。
import {GENRES, TEXT_TYPES, inTaxonomy} from "evals/taxonomy";

export const IdentityRoleSchema = z.enum(["reader", "writer", "editor", "pro"]);
export const ProvenanceSchema = z.enum(["human", "ai", "mixed", "unknown"]);
export const VisibilitySchema = z.enum(["private", "public"]);

// 客户端可提交的修订边类型：upload 只由服务器给 rev0，客户端不可自报。
export const ClientTransitionKindSchema = z.enum(["static_fix", "llm_fix", "user_fix"]);


// 上传原文：服务器据此建 Text 信封 + rev0（+ 同步 MachineScan，先算后藏）。
// 自报三项全可选：genre/textType 必须命中 taxonomy 白名单（宁缺勿错，错值污染分层切片）；sourceNote=作品名。
// originKind / *Source 等服务器字段客户端不可设（zod 未列字段一律剥除）。
export const CreateTextDtoSchema = z.object({
    text: z.string().min(1).max(60_000),
    declaredProvenance: ProvenanceSchema.default("unknown"),
    genre: z.string().refine((key) => inTaxonomy(GENRES, key), "genre 不在预定义题材值集").optional(),
    textType: z.string().refine((key) => inTaxonomy(TEXT_TYPES, key), "textType 不在预定义体裁值集").optional(),
    sourceNote: z.string().trim().min(1).max(200).optional(),
    visibility: VisibilitySchema,
    consent: z.boolean(),
});

// 提交一个新修订(rev1+)：在 parent 之上产出改文版本。ordinal 由服务器算，upload 边不可由客户端提交。
export const CreateRevisionDtoSchema = z.object({
    textId: z.string().min(1),
    parentId: z.string().min(1),
    body: z.string().min(1).max(60_000),
    transitionKind: ClientTransitionKindSchema,
    provenanceJson: z.string().max(200_000).optional(),
});

// 判定挂在 revision 上；四轴全可选但至少一项（五步①盲评两轴可跳、④复评四件套）。
// blind 由服务器按 revealedAt 判定；improvementScore 仅对有 parent 的 revision 合法（服务器校验）。
export const CreateJudgmentDtoSchema = z.object({
    revisionId: z.string().min(1),
    aiFlavor: z.number().int().min(0).max(5).optional(),
    wantReadOn: z.number().int().min(0).max(5).optional(),
    improvementScore: z.number().int().min(0).max(5).optional(),
    comment: z.string().min(1).max(4000).optional(),
}).refine(
    (dto) => dto.aiFlavor !== undefined || dto.wantReadOn !== undefined || dto.improvementScore !== undefined || dto.comment !== undefined,
    "至少提供一项判定（aiFlavor / wantReadOn / improvementScore / comment）",
);

export const SpanDtoSchema = z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
});

// 标注挂在 revision 上；"评原文/评改动"由 revision.ordinal 派生，不再需要 target。
export const CreateAnnotationDtoSchema = z.object({
    revisionId: z.string().min(1),
    span: SpanDtoSchema.refine((span) => span.end > span.start, "span.end 必须大于 span.start"),
    note: z.string().min(1).max(2000),
});

export type CreateTextDto = z.infer<typeof CreateTextDtoSchema>;
export type CreateRevisionDto = z.infer<typeof CreateRevisionDtoSchema>;
export type CreateJudgmentDto = z.infer<typeof CreateJudgmentDtoSchema>;
export type CreateAnnotationDto = z.infer<typeof CreateAnnotationDtoSchema>;

/**
 * 统一解析并校验 JSON body，避免 API 端重复写 zod 错误处理。
 */
export async function validateBody<T>(event: H3Event, schema: z.ZodType<T>): Promise<T> {
    const result = schema.safeParse(await readBody(event));
    if (!result.success) {
        throw createError({
            statusCode: 400,
            message: result.error.issues.map((issue) => issue.message).join("；") || "请求参数无效",
        });
    }
    return result.data;
}

/**
 * 服务器侧可见字数口径：去掉空白后按码点计数，和 evals 保持一致。
 */
export function visibleCharCount(text: string): number {
    return [...text.replace(/\s/gu, "")].length;
}

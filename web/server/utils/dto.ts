import type {H3Event} from "h3";
import {readBody} from "h3";
import {z} from "zod";

export const IdentityRoleSchema = z.enum(["reader", "writer", "editor", "pro"]);
export const ProvenanceSchema = z.enum(["human", "ai", "mixed", "unknown"]);
export const VisibilitySchema = z.enum(["private", "public"]);
export const AnnotationTargetSchema = z.enum(["original", "edit"]);

export const LoginRequestDtoSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),
    password: z.string().min(1).max(200),
});

export const RegisterRequestDtoSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),
    password: z.string().min(8).max(200),
    identityRole: IdentityRoleSchema.default("reader"),
});

export const CreateTextDtoSchema = z.object({
    text: z.string().min(1).max(60_000),
    declaredProvenance: ProvenanceSchema,
    visibility: VisibilitySchema,
    consent: z.boolean(),
});

export const CreateJudgmentDtoSchema = z.object({
    textId: z.string().min(1),
    aiFlavor: z.number().int().min(0).max(5),
    wantReadOn: z.number().int().min(0).max(5),
});

export const SpanDtoSchema = z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
});

export const CreateAnnotationDtoSchema = z.object({
    textId: z.string().min(1),
    target: AnnotationTargetSchema,
    span: SpanDtoSchema.refine((span) => span.end > span.start, "span.end 必须大于 span.start"),
    note: z.string().min(1).max(2000),
});

export const SubmitScanDtoSchema = z.object({
    textId: z.string().min(1),
    engineVersion: z.string().trim().min(1).max(120),
    hits: z.array(z.object({
        ruleId: z.string().min(1).max(200),
        span: SpanDtoSchema.refine((span) => span.end > span.start, "span.end 必须大于 span.start"),
        level: z.string().min(1).max(40),
        review: z.string().min(1).max(40),
    })).max(5000),
});

export type LoginRequestDto = z.infer<typeof LoginRequestDtoSchema>;
export type RegisterRequestDto = z.infer<typeof RegisterRequestDtoSchema>;
export type CreateTextDto = z.infer<typeof CreateTextDtoSchema>;
export type CreateJudgmentDto = z.infer<typeof CreateJudgmentDtoSchema>;
export type CreateAnnotationDto = z.infer<typeof CreateAnnotationDtoSchema>;
export type SubmitScanDto = z.infer<typeof SubmitScanDtoSchema>;

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

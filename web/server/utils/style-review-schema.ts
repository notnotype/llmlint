import {z} from "zod";

/** 私池评分必须同时提供两条主观评分轴；comment 仍可省略。 */
export const StyleReviewJudgmentRequestSchema = z.object({
    blindId: z.string().trim().min(1),
    aiFlavor: z.number().int().min(0).max(5),
    wantReadOn: z.number().int().min(0).max(5),
    comment: z.string().min(1).max(4000).optional(),
});

export type StyleReviewJudgmentRequest = z.infer<typeof StyleReviewJudgmentRequestSchema>;

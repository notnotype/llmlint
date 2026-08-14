import {requireCurrentUser} from "../../utils/auth";
import {validateBody} from "../../utils/dto";
import {findStyleReviewRecord, savePrivateStyleReviewJudgment} from "../../utils/style-review";
import {StyleReviewJudgmentRequestSchema} from "../../utils/style-review-schema";

export type StyleReviewJudgmentResponseDto = {
    judgmentId: string;
    blind: true;
};

/**
 * 保存匿名私池样本的双轴盲评；客户端只提交 opaque blindId，不接触 revisionId。
 */
export default defineEventHandler(async (event): Promise<StyleReviewJudgmentResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, StyleReviewJudgmentRequestSchema);
    const record = await findStyleReviewRecord(body.blindId);
    if (!record) {
        throw createError({statusCode: 404, message: "评测样本不存在"});
    }

    return savePrivateStyleReviewJudgment({
        userId: user.id,
        revisionId: record.revisionId,
        aiFlavor: body.aiFlavor,
        wantReadOn: body.wantReadOn,
        comment: body.comment ?? null,
    });
});

import {requireCurrentUser} from "../../utils/auth";
import {findStyleReviewRecord, publicStyleReviewItem, type StyleReviewItem} from "../../utils/style-review";

export type StyleReviewDetailResponseDto = StyleReviewItem;

/**
 * Resolve one private-pool sample by its opaque blindId. The caller never supplies a revisionId
 * to this lookup, and the response contains only the anonymous review DTO.
 */
export default defineEventHandler(async (event): Promise<StyleReviewDetailResponseDto> => {
    const user = await requireCurrentUser(event);
    const blindId = getRouterParam(event, "blindId")?.trim() ?? "";
    const record = blindId.length > 0 ? await findStyleReviewRecord(blindId) : null;
    if (!record) {
        throw createError({statusCode: 404, message: "评测样本不存在"});
    }
    return publicStyleReviewItem(record, user.id);
});

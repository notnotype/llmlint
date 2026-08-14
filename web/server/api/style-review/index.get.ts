import {requireCurrentUser} from "../../utils/auth";
import {listStyleReviewRecords, publicStyleReviewItem, type StyleReviewListResponse} from "../../utils/style-review";

export type StyleReviewListResponseDto = StyleReviewListResponse;

/** 私有文风盲评池：只返回匿名正文，来源与实验臂留在服务端。 */
export default defineEventHandler(async (event): Promise<StyleReviewListResponseDto> => {
    const user = await requireCurrentUser(event);
    const records = await listStyleReviewRecords();
    const items = records.map((record) => publicStyleReviewItem(record, user.id));
    return {items, count: items.length};
});

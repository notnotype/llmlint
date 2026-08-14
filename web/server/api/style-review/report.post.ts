import {requireAdmin} from "../../utils/auth";
import {adminStyleReviewItem, listStyleReviewRecords} from "../../utils/style-review";
import type {StyleReviewAdminItem} from "../../utils/style-review";

export type StyleReviewReportResponseDto = {
    /** Flat rows are sorted by anonymous pair key, arm, and blind id. */
    items: StyleReviewAdminItem[];
    count: number;
    /** Pair buckets retain the same pair/arm ordering as items. */
    pairs: Array<{pairRef: string; items: StyleReviewAdminItem[]}>;
};

/**
 * Private style experiment report. Only admins may read this endpoint: arm and machine
 * evidence are deliberately absent from all reviewer-facing APIs.
 */
export default defineEventHandler(async (event): Promise<StyleReviewReportResponseDto> => {
    await requireAdmin(event);
    const items = (await listStyleReviewRecords())
        .map(adminStyleReviewItem)
        .sort((left, right) => left.pairRef.localeCompare(right.pairRef) || left.arm.localeCompare(right.arm) || left.blindId.localeCompare(right.blindId));
    const pairs: Array<{pairRef: string; items: StyleReviewAdminItem[]}> = [];
    for (const item of items) {
        const pair = pairs.at(-1);
        if (pair?.pairRef === item.pairRef) {
            pair.items.push(item);
        } else {
            pairs.push({pairRef: item.pairRef, items: [item]});
        }
    }
    return {items, count: items.length, pairs};
});

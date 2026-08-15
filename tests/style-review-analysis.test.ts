import {describe, expect, it} from "vitest";
import type {ReviewerIdentity} from "../web/scripts/style-review-report";
import {buildStyleReviewReport} from "../web/scripts/style-review-report";
import {STYLE_REVIEW_ARMS, STYLE_REVIEW_CORPUS_PREFIX, STYLE_REVIEW_MODEL, type StyleReviewArm, type StyleReviewJudgment, type StyleReviewRecord} from "../web/server/utils/style-review";
import {median, signTestP} from "../evals/experiments/paired-stats";

const OWNER_ID = 41;
const OTHER_ID = 52;
const OWNER_OFFICIAL_ID = 1;
const SNAPSHOT = "sha256:" + "a".repeat(64);

function judgment(userId: number, aiFlavor: number | null, wantReadOn: number | null, blind = true): StyleReviewJudgment {
    return {userId, aiFlavor, wantReadOn, comment: null, blind};
}

function recordsWithJudgments(ownerValue = (arm: StyleReviewArm, pair: number) => ({aiFlavor: arm === "control" ? 4 : 1, wantReadOn: arm === "control" ? 2 : 5})): StyleReviewRecord[] {
    const records: StyleReviewRecord[] = [];
    for (let pair = 1; pair <= 5; pair += 1) {
        const pairRef = `pair-${pair}`;
        for (const [armIndex, arm] of STYLE_REVIEW_ARMS.entries()) {
            const corpusKey = `${STYLE_REVIEW_CORPUS_PREFIX}reference-${pair}/${`render-${String(pair).padStart(4, "0")}-${arm}.md`}`;
            const value = ownerValue(arm, pair);
            records.push({
                model: STYLE_REVIEW_MODEL,
                textId: `text-${pair}-${arm}`,
                corpusKey,
                sourceRef: `reference-${String(pair).padStart(4, "0")}.md`,
                blindId: `blind-${pair}-${arm}`,
                revisionId: `revision-${pair}-${arm}`,
                body: `正文 ${pair} ${arm}`,
                charCount: 1000 + pair + armIndex,
                pairRef,
                arm,
                myJudgment: null,
                machine: {docScore: 1 + armIndex, docPAi: 0.2 + armIndex / 10},
                judgments: [judgment(OWNER_ID, value.aiFlavor, value.wantReadOn)],
            });
        }
    }
    return records;
}

const reviewers: ReviewerIdentity[] = [
    {id: OWNER_ID, neuroBookUserId: OWNER_OFFICIAL_ID, role: "admin", status: "active"},
    {id: OTHER_ID, neuroBookUserId: 9, role: "user", status: "active"},
];

describe("style-arm-v2 人评统计合同", () => {
    it("只把 owner 的 20 份评分放进 primary，并按 pair 生成双轴四臂统计", () => {
        const records = recordsWithJudgments();
        for (const record of records) {
            record.judgments.push(judgment(OTHER_ID, 0, 0));
        }

        const report = buildStyleReviewReport(records, reviewers, OWNER_OFFICIAL_ID, SNAPSHOT, true);
        const distilledAi = report.ownerPrimary.contrasts.find((contrast) => contrast.leftArm === "control" && contrast.rightArm === "distilled" && contrast.axis === "aiFlavor");
        const distilledRead = report.ownerPrimary.contrasts.find((contrast) => contrast.leftArm === "control" && contrast.rightArm === "distilled" && contrast.axis === "wantReadOn");

        expect(report.experiment).toBe("style-arm-v2");
        expect(report.ownerPrimary.status).toBe("complete");
        expect(report.ownerPrimary.completeRevisionCount).toBe(20);
        expect(report.ownerPrimary.completeSubmissionCount).toBe(20);
        expect(report.ownerPrimary.pairs).toHaveLength(5);
        expect(report.ownerPrimary.pairs.every((pair) => STYLE_REVIEW_ARMS.every((arm) => (pair.arms[arm]?.judgments.length ?? 0) > 0))).toBe(true);
        expect(report.ownerPrimary.byReviewer.find((reviewer) => reviewer.id === OTHER_ID)).toBeUndefined();
        expect(report.allReviewers.completeSubmissionCount).toBe(40);
        expect(distilledAi).toMatchObject({primary: true, unit: "pair-level", rightBetter: 5, decidedCount: 5, ties: 0, pValue: 0.0625});
        expect(distilledRead).toMatchObject({primary: true, unit: "pair-level", rightBetter: 5, decidedCount: 5, ties: 0, pValue: 0.0625});
    });

    it("all-reviewers 先按 pair/arm 取中位数，p 值仍以 5 个 pair 为单位", () => {
        const records = recordsWithJudgments();
        for (const record of records) {
            record.judgments.push(judgment(OTHER_ID, 5, 0));
        }
        const report = buildStyleReviewReport(records, reviewers, OWNER_OFFICIAL_ID, SNAPSHOT, true);
        const contrast = report.allReviewers.contrasts.find((item) => item.leftArm === "control" && item.rightArm === "distilled" && item.axis === "aiFlavor");
        expect(contrast).toMatchObject({unit: "pair-level-median", decidedCount: 5, rightBetter: 5, pValue: 0.0625});
        expect(contrast?.observations).toHaveLength(5);
        expect(report.allReviewers.byReviewer.find((reviewer) => reviewer.id === OTHER_ID)?.completeRevisionCount).toBe(20);
    });

    it.each([
        ["缺失轴", (records: StyleReviewRecord[]) => { records[0]!.judgments[0]!.wantReadOn = null; }],
        ["非盲", (records: StyleReviewRecord[]) => { records[0]!.judgments[0]!.blind = false; }],
        ["超出范围", (records: StyleReviewRecord[]) => { records[0]!.judgments[0]!.aiFlavor = 6; }],
    ])("owner %s 时完整门禁拒绝且不使用其他 reviewer 补齐", (_label, mutate) => {
        const records = recordsWithJudgments();
        records[0]!.judgments.push(judgment(OTHER_ID, 1, 4));
        mutate(records);
        expect(() => buildStyleReviewReport(records, reviewers, OWNER_OFFICIAL_ID, SNAPSHOT, true)).toThrow(/owner-primary 未完成/);
    });

    it("共享统计函数保留中位数、ties 和 n=5 精确 p 值口径", () => {
        expect(median([1, 4, 2, 3])).toBe(2.5);
        expect(signTestP(5, 5)).toBe(0.0625);
        expect(signTestP(0, 0)).toBeNull();
    });
});

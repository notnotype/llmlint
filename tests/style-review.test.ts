import {describe, expect, it, vi} from "vitest";
import type {PrismaClient} from "../web/server/database/prisma";
import {savePrivateStyleReviewJudgment} from "../web/server/utils/style-review";
import {StyleReviewJudgmentRequestSchema} from "../web/server/utils/style-review-schema";

type UpsertArgs = {
    where: {userId_revisionId: {userId: number; revisionId: string}};
    create: {
        revisionId: string;
        userId: number;
        aiFlavor: number;
        wantReadOn: number;
        improvementScore: null;
        comment: string | null;
        blind: boolean;
    };
    update: {
        aiFlavor: number;
        wantReadOn: number;
        improvementScore: null;
        comment: string | null;
        blind: boolean;
    };
};

describe("私池文风评分合同", () => {
    it("不同用户可对同一 revision 各留一条盲评，同一用户重复提交复用复合键", async () => {
        const rows = new Map<string, string>();
        const calls: UpsertArgs[] = [];
        const upsert = vi.fn(async (args: UpsertArgs): Promise<{id: string}> => {
            calls.push(args);
            const key = `${args.where.userId_revisionId.userId}:${args.where.userId_revisionId.revisionId}`;
            const id = rows.get(key) ?? `judgment-${rows.size + 1}`;
            rows.set(key, id);
            return {id};
        });
        const client = {docJudgment: {upsert}} as unknown as Pick<PrismaClient, "docJudgment">;

        const first = await savePrivateStyleReviewJudgment({userId: 11, revisionId: "revision-1", aiFlavor: 2, wantReadOn: 4, comment: "第一份"}, client);
        const second = await savePrivateStyleReviewJudgment({userId: 12, revisionId: "revision-1", aiFlavor: 1, wantReadOn: 5, comment: null}, client);
        const repeat = await savePrivateStyleReviewJudgment({userId: 11, revisionId: "revision-1", aiFlavor: 3, wantReadOn: 3, comment: "改评分"}, client);

        expect(first).toEqual({judgmentId: "judgment-1", blind: true});
        expect(second).toEqual({judgmentId: "judgment-2", blind: true});
        expect(repeat).toEqual({judgmentId: "judgment-1", blind: true});
        expect(rows).toHaveLength(2);
        expect(calls).toHaveLength(3);
        for (const call of calls) {
            expect(call.create.blind).toBe(true);
            expect(call.update.blind).toBe(true);
            expect(call.where.userId_revisionId.revisionId).toBe("revision-1");
        }
        expect(calls[2]?.update).toMatchObject({aiFlavor: 3, wantReadOn: 3, improvementScore: null, comment: "改评分", blind: true});
    });

    it("缺少任一评分轴时拒绝请求", () => {
        expect(StyleReviewJudgmentRequestSchema.safeParse({blindId: "blind-1", wantReadOn: 4}).success).toBe(false);
        expect(StyleReviewJudgmentRequestSchema.safeParse({blindId: "blind-1", aiFlavor: 2}).success).toBe(false);
        expect(StyleReviewJudgmentRequestSchema.safeParse({blindId: "blind-1", aiFlavor: 2, wantReadOn: 4}).success).toBe(true);
    });
});

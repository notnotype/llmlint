import {requireCurrentUser} from "../utils/auth";
import {CreateJudgmentDtoSchema, validateBody} from "../utils/dto";
import {resolveOwnedRevision} from "../utils/ownership";
import {prisma} from "../database/prisma";

export type CreateJudgmentResponseDto = {
    judgmentId: string;
    blind: boolean;
};

/**
 * 写某 revision 的文档级判定（四轴全可选，DTO 保证至少一项）。整行覆盖语义：未提供的字段置 null。
 * blind 由服务端按 D-A 判定：写入时该 revision 的 revealedAt 仍为 null = 盲；创建与更新都重算
 * （已揭示后重打，blind 翻 false）。improvementScore 只对有 parent 的 revision 合法（rev0 没有"这轮改得好不好"）。
 */
export default defineEventHandler(async (event): Promise<CreateJudgmentResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CreateJudgmentDtoSchema);
    const revision = await resolveOwnedRevision(body.revisionId, user.id, {allowPublic: true});

    if (body.improvementScore !== undefined && revision.parentId === null) {
        throw createError({statusCode: 400, message: "improvementScore 只能评价改文修订（rev0 无本轮改动）"});
    }

    const blind = revision.revealedAt === null;
    const scores = {
        aiFlavor: body.aiFlavor ?? null,
        wantReadOn: body.wantReadOn ?? null,
        improvementScore: body.improvementScore ?? null,
        comment: body.comment ?? null,
    };

    const judgment = await prisma.docJudgment.upsert({
        where: {userId_revisionId: {userId: user.id, revisionId: revision.id}},
        create: {revisionId: revision.id, userId: user.id, ...scores, blind},
        update: {...scores, blind},
    });
    return {judgmentId: judgment.id, blind};
});

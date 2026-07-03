import {requireCurrentUser} from "../utils/auth";
import {CreateJudgmentDtoSchema, validateBody} from "../utils/dto";
import {prisma} from "../database/prisma";

export type CreateJudgmentResponseDto = {
    judgmentId: string;
};

/**
 * 写入盲评文档级两轴分。phase/blind/userId 全由服务端固定。
 */
export default defineEventHandler(async (event): Promise<CreateJudgmentResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CreateJudgmentDtoSchema);
    const text = await prisma.text.findUnique({
        where: {id: body.textId},
        select: {id: true, uploaderId: true, visibility: true},
    });
    if (!text || (text.uploaderId !== user.id && text.visibility !== "public")) {
        throw createError({
            statusCode: 404,
            message: "正文不存在",
        });
    }

    const judgment = await prisma.docJudgment.upsert({
        where: {
            userId_textId_phase: {
                userId: user.id,
                textId: body.textId,
                phase: "pre_edit",
            },
        },
        create: {
            textId: body.textId,
            userId: user.id,
            aiFlavor: body.aiFlavor,
            wantReadOn: body.wantReadOn,
            phase: "pre_edit",
            blind: true,
        },
        update: {
            aiFlavor: body.aiFlavor,
            wantReadOn: body.wantReadOn,
            blind: true,
        },
    });

    return {judgmentId: judgment.id};
});

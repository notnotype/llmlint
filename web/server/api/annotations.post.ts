import {requireCurrentUser} from "../utils/auth";
import {CreateAnnotationDtoSchema, validateBody} from "../utils/dto";
import {prisma} from "../database/prisma";

export type CreateAnnotationResponseDto = {
    annotationId: string;
};

/**
 * 写入 span 自然语言标注。note 原样保存，不在采集时结构化。
 */
export default defineEventHandler(async (event): Promise<CreateAnnotationResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CreateAnnotationDtoSchema);
    const text = await prisma.text.findUnique({
        where: {id: body.textId},
        select: {id: true, body: true, uploaderId: true, visibility: true},
    });
    if (!text || (text.uploaderId !== user.id && text.visibility !== "public")) {
        throw createError({
            statusCode: 404,
            message: "正文不存在",
        });
    }
    if (body.span.end > text.body.length) {
        throw createError({
            statusCode: 400,
            message: "标注范围超出正文长度",
        });
    }

    const annotation = await prisma.spanAnnotation.create({
        data: {
            textId: body.textId,
            userId: user.id,
            target: body.target,
            start: body.span.start,
            end: body.span.end,
            note: body.note,
        },
    });

    return {annotationId: annotation.id};
});

import {requireCurrentUser} from "../utils/auth";
import {CreateAnnotationDtoSchema, validateBody} from "../utils/dto";
import {resolveOwnedRevision} from "../utils/ownership";
import {prisma} from "../database/prisma";

export type CreateAnnotationResponseDto = {
    annotationId: string;
};

/**
 * 写某 revision 的 span 自然语言标注。note 原样保存，不在采集时结构化。
 * "评原文/评改动"由 revision.ordinal 派生，不再需要 target 字段。
 */
export default defineEventHandler(async (event): Promise<CreateAnnotationResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CreateAnnotationDtoSchema);
    const revision = await resolveOwnedRevision(body.revisionId, user.id, {allowPublic: true});
    if (body.span.end > revision.body.length) {
        throw createError({statusCode: 400, message: "标注范围超出正文长度"});
    }

    const annotation = await prisma.spanAnnotation.create({
        data: {
            revisionId: revision.id,
            userId: user.id,
            start: body.span.start,
            end: body.span.end,
            note: body.note,
        },
    });
    return {annotationId: annotation.id};
});

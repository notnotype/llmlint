import {requireCurrentUser} from "../utils/auth";
import {CreateTextDtoSchema, validateBody, visibleCharCount} from "../utils/dto";
import {prisma} from "../database/prisma";

export type CreateTextResponseDto = {
    textId: string;
    charCount: number;
};

/**
 * 创建用户上传正文。origin/uploader/charCount/classification 全由服务端设置。
 */
export default defineEventHandler(async (event): Promise<CreateTextResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CreateTextDtoSchema);
    const text = await prisma.text.create({
        data: {
            body: body.text,
            charCount: visibleCharCount(body.text),
            genre: null,
            pov: null,
            textType: null,
            originKind: "user_upload",
            declaredProvenance: body.declaredProvenance,
            uploaderId: user.id,
            visibility: body.visibility,
            consent: body.consent,
        },
    });

    return {textId: text.id, charCount: text.charCount};
});

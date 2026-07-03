import {requireCurrentUser} from "../utils/auth";
import {SubmitScanDtoSchema, validateBody} from "../utils/dto";
import {prisma} from "../database/prisma";

export type SubmitScanResponseDto = {
    machineRecordId: string;
};

/**
 * 写入浏览器扫描结果。命中随 engineVersion 固化，便于后续按规则版本解释。
 */
export default defineEventHandler(async (event): Promise<SubmitScanResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, SubmitScanDtoSchema);
    const text = await prisma.text.findUnique({
        where: {id: body.textId},
        select: {id: true, uploaderId: true},
    });
    if (!text || text.uploaderId !== user.id) {
        throw createError({
            statusCode: 404,
            message: "正文不存在",
        });
    }

    const record = await prisma.machineRecord.upsert({
        where: {textId: body.textId},
        create: {
            textId: body.textId,
            engineVersion: body.engineVersion,
            hitsJson: JSON.stringify(body.hits),
            scannedAt: new Date(),
        },
        update: {
            engineVersion: body.engineVersion,
            hitsJson: JSON.stringify(body.hits),
            scannedAt: new Date(),
        },
    });

    return {machineRecordId: record.id};
});

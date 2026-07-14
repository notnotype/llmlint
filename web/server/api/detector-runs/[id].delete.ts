import {requireCurrentUser} from "../../utils/auth";
import {cancelMachineDetectRun} from "../../utils/detect";
import {prisma} from "../../database/prisma";

/** 真正取消外部检测请求。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const runId = getRouterParam(event, "id") ?? "";
    const run = await prisma.machineDetectRun.findFirst({
        where: {id: runId, revision: {text: {uploaderId: user.id}}},
        select: {revisionId: true},
    });
    if (!run) {
        throw createError({statusCode: 404, message: "外部检测任务不存在"});
    }
    await cancelMachineDetectRun(runId, run.revisionId);
    return {ok: true};
});

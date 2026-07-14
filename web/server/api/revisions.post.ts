import {requireCurrentUser} from "../utils/auth";
import {recordMachineDetect} from "../utils/detect";
import {startMachineLlmReview} from "../utils/llm-review";
import {CreateRevisionDtoSchema, validateBody, visibleCharCount} from "../utils/dto";
import {recordMachineScan} from "../utils/scan";
import {prisma} from "../database/prisma";

export type CreateRevisionResponseDto = {
    revisionId: string;
    ordinal: number;
};

/**
 * 在 parent 之上提交一个新修订（改文循环产物：static/llm/user 修复），随后同步扫描落 MachineScan（先算后藏）。
 * ordinal 服务端算（文档内单调自增，分叉不复用）；charCount 服务端算；upload 边不可由客户端提交。
 * 响应绝不带机器结果（D2）：rev_k 的机器数据由 reveal / machine 端点在揭示后提供。
 */
export default defineEventHandler(async (event): Promise<CreateRevisionResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CreateRevisionDtoSchema);

    // parent 必须存在、属于同一 textId、且文档归当前用户（改文只在自己的文档上）。
    const parent = await prisma.revision.findUnique({
        where: {id: body.parentId},
        select: {id: true, textId: true, text: {select: {uploaderId: true}}},
    });
    if (!parent || parent.textId !== body.textId || parent.text.uploaderId !== user.id) {
        throw createError({statusCode: 404, message: "父修订不存在"});
    }

    // ordinal 取文档内最大值 +1，与 @@unique([textId, ordinal]) 一致。
    const max = await prisma.revision.aggregate({where: {textId: body.textId}, _max: {ordinal: true}});
    const ordinal = (max._max.ordinal ?? -1) + 1;

    const revision = await prisma.revision.create({
        data: {
            textId: body.textId,
            parentId: body.parentId,
            ordinal,
            body: body.body,
            charCount: visibleCharCount(body.body),
            transitionKind: body.transitionKind,
            provenanceJson: body.provenanceJson ?? null,
        },
    });
    await recordMachineScan(revision.id, body.body);
    // W3：外部检测器挂响应后异步跑（先算后藏；失败只记日志不落行，不阻塞提交）。
    event.waitUntil(recordMachineDetect(revision.id, body.body));
    // Task 17 工单 C：LLM 规则评审同模式异步跑（失败/未配置在 util 内静默降级）。
    event.waitUntil(startMachineLlmReview(revision.id, user.id, body.body));
    return {revisionId: revision.id, ordinal: revision.ordinal};
});

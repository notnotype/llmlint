import {requireCurrentUser} from "../utils/auth";
import {backfillTextClassification} from "../utils/classify";
import {recordMachineDetect} from "../utils/detect";
import {startMachineLlmReview} from "../utils/llm-review";
import {CreateTextDtoSchema, validateBody, visibleCharCount} from "../utils/dto";
import {recordMachineScan} from "../utils/scan";
import {prisma} from "../database/prisma";

export type CreateTextResponseDto = {
    textId: string;
    revisionId: string;
    charCount: number;
};

/**
 * 创建文档信封 + rev0（原文，transitionKind=upload），随后同步扫描落 MachineScan（先算后藏）。
 * origin/uploader/charCount/*Source 全由服务端设置；上传通路 originKind 恒 uploaded（curated/generated 走 W5 导入）。
 * 自报 genre/textType 提供时来源标 user（D-B 三值三源）；响应绝不带机器结果（D2，揭示走 reveal 端点）。
 */
export default defineEventHandler(async (event): Promise<CreateTextResponseDto> => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, CreateTextDtoSchema);
    const text = await prisma.text.create({
        data: {
            genre: body.genre ?? null,
            genreSource: body.genre === undefined ? null : "user",
            pov: null,
            textType: body.textType ?? null,
            textTypeSource: body.textType === undefined ? null : "user",
            originKind: "uploaded",
            declaredProvenance: body.declaredProvenance,
            sourceNote: body.sourceNote ?? null,
            uploaderId: user.id,
            visibility: body.visibility,
            consent: body.consent,
            revisions: {
                create: {
                    ordinal: 0,
                    parentId: null,
                    body: body.text,
                    charCount: visibleCharCount(body.text),
                    transitionKind: "upload",
                },
            },
        },
        include: {revisions: true},
    });

    const rev0 = text.revisions[0];
    if (!rev0) {
        throw createError({statusCode: 500, message: "创建 rev0 失败"});
    }
    await recordMachineScan(rev0.id, body.text);
    // W6：LLM 分类补空挂在响应之后异步执行（nitro waitUntil 只登记 promise、不阻塞响应；
    // 失败/未配置在 util 内静默降级，绝不影响上传主流程）。
    event.waitUntil(backfillTextClassification(text.id, body.text));
    // W3：外部检测器同样挂响应后异步跑（先算后藏，detects 由 reveal/machine 端点在揭示后提供；
    // HF 慢/不稳，失败只记日志不落行，与分类通道互不影响）。
    event.waitUntil(recordMachineDetect(rev0.id, body.text));
    // Task 17 工单 C：LLM 规则评审同模式异步跑（8 条 llmRules 一次调用；失败/未配置在 util 内静默降级）。
    event.waitUntil(startMachineLlmReview(rev0.id, user.id));
    return {textId: text.id, revisionId: rev0.id, charCount: rev0.charCount};
});

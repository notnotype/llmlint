import {prisma} from "../database/prisma";

export type OwnedRevision = {
    id: string;
    textId: string;
    ordinal: number;
    /** 血缘软指针；rev0 为 null（improvementScore 只对非 null 合法）。 */
    parentId: string | null;
    body: string;
    charCount: number;
    /** 机器结果首次揭示时刻；null=未揭示（判定写入时 blind 的唯一依据，D-A）。 */
    revealedAt: Date | null;
};

/** 通过所有权校验的 Text（当前只有 id 有消费点；改写基底正文由客户端随请求提交，不在这里取）。 */
export type OwnedText = {id: string};

/**
 * 解析一个 Text 并校验所有权：仅上传者本人（llm-fix job 等按文本发起的操作用）。
 * 找不到或无权一律抛 404（不区分"不存在/无权"，避免枚举——与 resolveOwnedRevision 同纪律）。
 */
export async function resolveOwnedText(textId: string, userId: number): Promise<OwnedText> {
    const text = await prisma.text.findUnique({where: {id: textId}, select: {id: true, uploaderId: true}});
    if (!text || text.uploaderId !== userId) {
        throw createError({statusCode: 404, message: "文本不存在"});
    }
    return {id: text.id};
}

/**
 * 解析一个 revision 并校验访问权：默认仅上传者本人；allowPublic 时公开文档也放行（众包判定/标注）。
 * 找不到或无权一律抛 404（不区分"不存在/无权"，避免枚举）。
 * 返回 body 供标注做越界校验；body ≤ 60k，overfetch 可忽略。
 */
export async function resolveOwnedRevision(revisionId: string, userId: number, options: {allowPublic?: boolean} = {}): Promise<OwnedRevision> {
    const revision = await prisma.revision.findUnique({
        where: {id: revisionId},
        select: {
            id: true,
            textId: true,
            ordinal: true,
            parentId: true,
            body: true,
            charCount: true,
            revealedAt: true,
            text: {select: {uploaderId: true, visibility: true}},
        },
    });
    const canAccess = revision !== null
        && (revision.text.uploaderId === userId || (options.allowPublic === true && revision.text.visibility === "public"));
    if (!revision || !canAccess) {
        throw createError({statusCode: 404, message: "修订不存在"});
    }
    return {
        id: revision.id,
        textId: revision.textId,
        ordinal: revision.ordinal,
        parentId: revision.parentId,
        body: revision.body,
        charCount: revision.charCount,
        revealedAt: revision.revealedAt,
    };
}

/** Agent API 的 D2 + owner 联合闸门：未揭示不能通过 session 旁路读取分析 timeline/report。 */
export async function requireOwnedRevealedAgentSession(sessionId: string, userId: number): Promise<void> {
    const session = await prisma.agentSession.findFirst({
        where: {id: sessionId, userId},
        select: {revision: {select: {revealedAt: true}}},
    });
    if (!session) throw createError({statusCode: 404, message: "Agent session 不存在"});
    if (session.revision.revealedAt === null) throw createError({statusCode: 403, message: "机器结果尚未揭示"});
}

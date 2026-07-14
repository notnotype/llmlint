import {requireCurrentUser} from "../utils/auth";
import {prisma} from "../database/prisma";

/** 历史列表一行（Task 15 P0-B：检测历史，只看当前解析身份）。 */
export type TextHistoryItemDto = {
    textId: string;
    /** 列表展示用摘要：sourceNote（作品名）优先；否则 rev0 正文压空白后的前 30 字 */
    preview: string;
    createdAt: string;
    /** 谱系版本数（rev0 也算一版） */
    revisionCount: number;
    /** 最新版本的 ordinal（= head） */
    latestOrdinal: number;
    /**
     * 最新版本的引擎 docScore。null = 该版本尚未揭示（D2：未 reveal 不带任何机器数据）
     * 或该版本无扫描记录；多引擎版本并存时取最近一次扫描。
     */
    latestDocScore: number | null;
};

/**
 * 检测历史列表（Task 15 P0-B）：当前用户上传的全部文本，按 createdAt 降序。
 * 内网量小不分页。登录关闭时统一身份层返回稳定的本地开发用户；开启时返回 session 用户。
 * D2 纪律：latestDocScore 只在最新版本已揭示（revealedAt 非空）时返回，未揭示恒 null，不偷跑机器数据。
 */
export default defineEventHandler(async (event): Promise<TextHistoryItemDto[]> => {
    const user = await requireCurrentUser(event);
    // 只取轻量字段；正文 body 不进这条查询（60k × N 太重），rev0 摘要单独按需取。
    const texts = await prisma.text.findMany({
        where: {uploaderId: user.id},
        orderBy: {createdAt: "desc"},
        select: {
            id: true,
            sourceNote: true,
            createdAt: true,
            revisions: {orderBy: {ordinal: "asc"}, select: {id: true, ordinal: true, revealedAt: true}},
        },
    });

    // rev0 正文只为「无 sourceNote 的文本」取（做前 30 字摘要）。
    const previewTextIds = texts.filter((text) => !text.sourceNote?.trim()).map((text) => text.id);
    const rev0Bodies = previewTextIds.length === 0 ? [] : await prisma.revision.findMany({
        where: {textId: {in: previewTextIds}, ordinal: 0},
        select: {textId: true, body: true},
    });
    const rev0BodyByTextId = new Map(rev0Bodies.map((revision) => [revision.textId, revision.body]));

    // 最新版本且已揭示的 revision 才查 docScore（D2）；多引擎版本取最近一次扫描（与 revisionMachineDto 同口径）。
    const revealedHeadIds: string[] = [];
    for (const text of texts) {
        const head = text.revisions[text.revisions.length - 1];
        if (head !== undefined && head.revealedAt !== null) {
            revealedHeadIds.push(head.id);
        }
    }
    const scans = revealedHeadIds.length === 0 ? [] : await prisma.machineScan.findMany({
        where: {revisionId: {in: revealedHeadIds}},
        orderBy: {scannedAt: "asc"},
        select: {revisionId: true, docScore: true},
    });
    // 升序遍历逐条覆盖 ⇒ Map 里留下的就是每个 revision 最近一次扫描的 docScore。
    const docScoreByRevisionId = new Map(scans.map((scan) => [scan.revisionId, scan.docScore]));

    return texts.map((text) => {
        const head = text.revisions[text.revisions.length - 1];
        const sourceNote = text.sourceNote?.trim() ?? "";
        // 摘要：sourceNote 优先；否则 rev0 正文压空白取前 30 个字符（UTF-16 slice，摘要用途足够）。
        const preview = sourceNote.length > 0
            ? sourceNote
            : (rev0BodyByTextId.get(text.id) ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
        return {
            textId: text.id,
            preview,
            createdAt: text.createdAt.toISOString(),
            revisionCount: text.revisions.length,
            latestOrdinal: head?.ordinal ?? 0,
            latestDocScore: head === undefined ? null : docScoreByRevisionId.get(head.id) ?? null,
        };
    });
});

import {requireCurrentUser} from "../../../utils/auth";
import {resolveOwnedRevision} from "../../../utils/ownership";
import type {RevisionMachineDto} from "../../../utils/scan";
import {revisionMachineDto} from "../../../utils/scan";
import {prisma} from "../../../database/prisma";

export type RevealResponseDto = RevisionMachineDto & {
    revisionId: string;
    /** 本次请求生效的揭示时刻（ISO）；重复调用幂等返回首次时刻。 */
    revealedAt: string;
};

/**
 * 揭示一个 revision 的机器结果（D-A）：owner 才可揭示；revealedAt 为空则设为 now，已设则幂等不动。
 * 揭示之后该 revision 上的判定写入 blind=false；返回 {scan, detects}（detect 通道 W3 接，当前为空数组）。
 */
export default defineEventHandler(async (event): Promise<RevealResponseDto> => {
    const user = await requireCurrentUser(event);
    const revisionId = getRouterParam(event, "id") ?? "";
    const revision = await resolveOwnedRevision(revisionId, user.id);

    let revealedAt = revision.revealedAt;
    if (revealedAt === null) {
        revealedAt = new Date();
        await prisma.revision.update({where: {id: revision.id}, data: {revealedAt}});
    }

    const machine = await revisionMachineDto(revision.id);
    return {revisionId: revision.id, revealedAt: revealedAt.toISOString(), ...machine};
});

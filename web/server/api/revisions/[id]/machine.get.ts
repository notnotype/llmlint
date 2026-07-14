import {requireCurrentUser} from "../../../utils/auth";
import {resolveOwnedRevision} from "../../../utils/ownership";
import type {RevisionMachineDto} from "../../../utils/scan";
import {revisionMachineDto} from "../../../utils/scan";

export type RevisionMachineResponseDto = RevisionMachineDto & {
    revisionId: string;
    revealedAt: string;
};

/**
 * 读取一个 revision 的机器结果（扫描 + 检测器）。D2 服务器强制：未揭示（revealedAt 为 null）一律 403，
 * 先调 reveal 端点显式揭示；detect 异步未到时 detects 为空数组，前端可轮询本端点。
 */
export default defineEventHandler(async (event): Promise<RevisionMachineResponseDto> => {
    const user = await requireCurrentUser(event);
    const revisionId = getRouterParam(event, "id") ?? "";
    const revision = await resolveOwnedRevision(revisionId, user.id);

    if (revision.revealedAt === null) {
        throw createError({statusCode: 403, message: "机器结果尚未揭示，请先完成盲评并调用 reveal"});
    }

    const machine = await revisionMachineDto(revision.id);
    return {revisionId: revision.id, revealedAt: revision.revealedAt.toISOString(), ...machine};
});

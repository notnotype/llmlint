import {requireCurrentUser} from "../../../utils/auth";
import {resolveOwnedRevision} from "../../../utils/ownership";
import {createMachineDetectRetry} from "../../../utils/detect";

/** 重试外部检测，旧 attempt 保留。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const revision = await resolveOwnedRevision(getRouterParam(event, "id") ?? "", user.id);
    const {runId, task} = await createMachineDetectRetry(revision.id);
    event.waitUntil(task);
    return {runId, status: "queued" as const};
});

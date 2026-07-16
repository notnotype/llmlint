import {requireCurrentUser} from "../../../../utils/auth";
import {agentHarness} from "../../../../agent";
import {requireOwnedRevealedAgentSession} from "../../../../utils/ownership";

/** 为最近一次 terminal 失败创建新 invocation。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const sessionId = getRouterParam(event, "id") ?? "";
    await requireOwnedRevealedAgentSession(sessionId, user.id);
    return agentHarness.retry(sessionId, user.id);
});

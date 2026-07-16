import {requireCurrentUser} from "../../../utils/auth";
import {agentHarness} from "../../../agent";
import {requireOwnedRevealedAgentSession} from "../../../utils/ownership";

/** 恢复持久化 Agent session snapshot。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const sessionId = getRouterParam(event, "id") ?? "";
    await requireOwnedRevealedAgentSession(sessionId, user.id);
    return agentHarness.getSnapshot(sessionId, user.id);
});

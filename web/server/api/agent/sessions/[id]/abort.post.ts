import {requireCurrentUser} from "../../../../utils/auth";
import {agentHarness} from "../../../../agent/local-harness";
import {requireOwnedRevealedAgentSession} from "../../../../utils/ownership";

/** 真正取消当前 invocation，AbortSignal 会传播到 provider。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const sessionId = getRouterParam(event, "id") ?? "";
    await requireOwnedRevealedAgentSession(sessionId, user.id);
    return agentHarness.abort(sessionId, user.id);
});

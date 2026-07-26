import {requireCurrentUser} from "../../../../utils/auth";
import {agentHarness} from "../../../../agent";
import {requireOwnedRevealedAgentSession} from "../../../../utils/ownership";
import {z} from "zod";
import {validateBody} from "../../../../utils/dto";

const AbortSchema = z.object({invocationId: z.string().min(1)});

/** 真正取消当前 invocation，AbortSignal 会传播到 provider。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, AbortSchema);
    const sessionId = getRouterParam(event, "id") ?? "";
    await requireOwnedRevealedAgentSession(sessionId, user.id);
    return agentHarness.abort(sessionId, user.id, body.invocationId);
});

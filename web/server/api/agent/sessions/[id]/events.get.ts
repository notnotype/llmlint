import {createEventStream, getQuery} from "h3";
import {requireCurrentUser} from "../../../../utils/auth";
import {agentHarness} from "../../../../agent";
import {AgentSseLifecycle} from "../../../../agent/sse-lifecycle";
import {requireOwnedRevealedAgentSession} from "../../../../utils/ownership";

/** Harness 风格 SSE：只投递增量，断线后以 snapshot 恢复。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const sessionId = getRouterParam(event, "id") ?? "";
    await requireOwnedRevealedAgentSession(sessionId, user.id);
    await agentHarness.getSnapshot(sessionId, user.id);
    const query = getQuery(event);
    const after = Number(query.after ?? 0);
    const eventEpoch = typeof query.eventEpoch === "string" ? query.eventEpoch : undefined;
    const stream = createEventStream(event);
    const subscription = agentHarness.subscribeEvents(sessionId, {eventEpoch, after: Number.isFinite(after) && after >= 0 ? after : 0});
    const lifecycle = new AgentSseLifecycle(stream, subscription);
    try {
        await Promise.all([stream.send(), lifecycle.start()]);
    } finally {
        await lifecycle.close();
        await lifecycle.done;
    }
});

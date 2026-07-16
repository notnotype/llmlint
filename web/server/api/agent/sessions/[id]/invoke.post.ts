import {z} from "zod";
import {requireCurrentUser} from "../../../../utils/auth";
import {agentHarness} from "../../../../agent";
import {validateBody} from "../../../../utils/dto";
import {requireOwnedRevealedAgentSession} from "../../../../utils/ownership";

const InvokeSchema = z.object({
    mode: z.enum(["prompt", "continue"]),
    phase: z.enum(["analysis", "optimize"]),
    message: z.string().max(4000).optional(),
    body: z.string().min(1).max(60_000),
    selection: z.object({from: z.number().int().min(0), to: z.number().int().positive(), text: z.string().min(1)}).optional(),
}).superRefine((value, ctx) => {
    if (value.phase === "optimize" && value.mode === "prompt" && !value.message?.trim()) {
        ctx.addIssue({code: "custom", path: ["message"], message: "改写 prompt 必须提供用户要求"});
    }
    if (value.selection && (value.selection.to <= value.selection.from || value.body.slice(value.selection.from, value.selection.to) !== value.selection.text)) {
        ctx.addIssue({code: "custom", path: ["selection"], message: "选区坐标与当前正文不一致"});
    }
});

/** 在同一 session 上启动新的 analysis/optimize invocation。 */
export default defineEventHandler(async (event) => {
    const user = await requireCurrentUser(event);
    const body = await validateBody(event, InvokeSchema);
    const sessionId = getRouterParam(event, "id") ?? "";
    await requireOwnedRevealedAgentSession(sessionId, user.id);
    return agentHarness.invoke(sessionId, user.id, body);
});

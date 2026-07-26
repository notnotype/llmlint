export type AgentAbortResponse = {status: "idle" | "aborting"};

/** idle 表示 terminal 已先发生，调用方必须立即以 durable snapshot 恢复状态。 */
export function abortNeedsRecovery(response: AgentAbortResponse): boolean {
    return response.status === "idle";
}

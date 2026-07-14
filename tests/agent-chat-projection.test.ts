import {describe, expect, it} from "vitest";
import {applyAgentEvent} from "../web/app/utils/agent-chat-projection";
import type {AgentSessionEvent} from "../web/shared/agent-harness";

const base = {eventEpoch: "e1", sessionId: "s1", invocationId: "i1"};
const assistant = (text: string) => ({role: "assistant", content: [{type: "text", text}], api: "openai-completions", provider: "test", model: "test", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}, stopReason: "stop", timestamp: 1}) as never;

describe("Agent chat live reducer", () => {
    it("message_update 原位覆盖流式 assistant，不追加重复气泡", () => {
        const start = {...base, seq: 1, kind: "runtime", event: {type: "message_start", turn: 1, message: assistant("")}} as AgentSessionEvent;
        const update = {...base, seq: 2, kind: "runtime", event: {type: "message_update", turn: 1, message: assistant("正在输出"), assistantMessageEvent: {type: "text_delta"}}} as unknown as AgentSessionEvent;
        const messages = applyAgentEvent(applyAgentEvent([], start), update);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({content: "正在输出", status: "streaming"});
    });

    it("工具 start/end 更新同一工具卡状态", () => {
        const start = {...base, seq: 1, kind: "runtime", event: {type: "tool_execution_start", turn: 1, toolCallId: "t1", toolName: "replace", args: {oldText: "甲"}}} as AgentSessionEvent;
        const end = {...base, seq: 2, kind: "runtime", event: {type: "tool_execution_end", turn: 1, toolCallId: "t1", toolName: "replace", result: "完成", isError: false}} as AgentSessionEvent;
        const messages = applyAgentEvent(applyAgentEvent([], start), end);
        expect(messages[0]?.tools?.[0]).toMatchObject({id: "t1", status: "success", result: "完成"});
    });
});

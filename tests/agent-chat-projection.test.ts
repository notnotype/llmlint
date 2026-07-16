import {describe, expect, it} from "vitest";
import {applyAgentEvent, messagesFromSnapshot} from "../web/app/utils/agent-chat-projection";
import type {AgentSessionEvent, AgentSessionSnapshot} from "../web/shared/agent-harness";

const base = {eventEpoch: "e1", sessionId: "s1", invocationId: "i1"};
const assistant = (text: string) => ({role: "assistant", content: [{type: "text", text}], api: "openai-completions", provider: "test", model: "test", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}, stopReason: "stop", timestamp: 1}) as never;

describe("Agent chat live reducer", () => {
    it("message_update 原位覆盖流式 assistant，不追加重复气泡", () => {
        const start = {...base, seq: 1, kind: "runtime", event: {type: "message_start", turn: 1, message: assistant("")}} as AgentSessionEvent;
        const update = {...base, seq: 2, kind: "runtime", event: {type: "message_update", turn: 1, message: assistant("正在输出")}} as AgentSessionEvent;
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

    it("刷新后从 durable timeline 恢复 thinking、Tool Call 和 Tool Result", () => {
        const snapshot: AgentSessionSnapshot = {
            sessionId: "s1",
            revisionId: "r1",
            profileKey: "llmlint.review",
            status: "idle",
            activeInvocation: null,
            invocations: [],
            entries: [{
                id: "assistant-1",
                invocationId: "i1",
                kind: "assistant",
                payload: {text: "准备修改", thinking: "先定位原句", tools: [{id: "t1", name: "replace", args: {oldText: "甲"}, status: "running"}]},
                createdAt: new Date(1).toISOString(),
            }, {
                id: "tool-1",
                invocationId: "i1",
                kind: "tool_result",
                payload: {toolCallId: "t1", toolName: "replace", text: "完成", isError: false},
                createdAt: new Date(2).toISOString(),
            }],
            report: null,
            hits: [],
            eventCursor: {eventEpoch: "e1", after: 2},
        };

        const messages = messagesFromSnapshot(snapshot);

        expect(messages[0]).toMatchObject({content: "准备修改", thinking: "先定位原句", tools: [{id: "t1", status: "running"}]});
        expect(messages[1]?.tools?.[0]).toMatchObject({id: "t1", status: "success", result: "完成"});
    });
});

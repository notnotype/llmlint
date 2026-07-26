import {describe, expect, it} from "vitest";
import {applyAgentEvent, messagesFromSnapshot} from "../web/app/utils/agent-chat-projection";
import type {AgentSessionEvent, AgentSessionSnapshot} from "../web/shared/agent-harness";

const base = {eventEpoch: "e1", sessionId: "s1", invocationId: "i1"};
const assistant = (text: string) => ({role: "assistant", content: [{type: "text", text}], api: "openai-completions", provider: "test", model: "test", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}, stopReason: "stop", timestamp: 1}) as never;

describe("Agent chat live reducer", () => {
    it("刷新后按真实来源展示 System Prompt、宿主要求和内部模型输入", () => {
        const snapshot: AgentSessionSnapshot = {
            sessionId: "s1",
            revisionId: "r1",
            profileKey: "llmlint.review",
            status: "idle",
            activeInvocation: null,
            activeWorkspace: null,
            invocations: [],
            entries: [
                {id: "system-1", invocationId: "i1", kind: "system", payload: {text: "系统规则", source: "system"}, createdAt: new Date(1).toISOString()},
                {id: "request-1", invocationId: "i1", kind: "user", payload: {text: "一键修到底", source: "host_request"}, createdAt: new Date(2).toISOString()},
                {id: "model-1", invocationId: "i1", kind: "user", payload: {text: "用户要求：一键修到底\n\n当前正文", source: "model_input"}, createdAt: new Date(3).toISOString()},
            ],
            report: null,
            hits: [],
            eventCursor: {eventEpoch: "e1", after: 3},
        };

        expect(messagesFromSnapshot(snapshot)).toEqual([
            expect.objectContaining({type: "system", content: "系统规则", source: "system"}),
            expect.objectContaining({type: "user", content: "一键修到底", source: "host_request"}),
            expect.objectContaining({type: "user", content: "用户要求：一键修到底\n\n当前正文", source: "model_input"}),
        ]);
    });

    it("live SSE 同样保留 System Prompt 和第一条模型输入", () => {
        const system = {...base, seq: 1, kind: "session", event: {type: "entry", entry: {id: "system-live", invocationId: "i1", kind: "system", payload: {text: "系统规则", source: "system"}, createdAt: new Date(1).toISOString()}}} as AgentSessionEvent;
        const modelInput = {...base, seq: 2, kind: "session", event: {type: "entry", entry: {id: "input-live", invocationId: "i1", kind: "user", payload: {text: "开始分析", source: "model_input"}, createdAt: new Date(2).toISOString()}}} as AgentSessionEvent;

        const messages = applyAgentEvent(applyAgentEvent([], system), modelInput);

        expect(messages).toEqual([
            expect.objectContaining({type: "system", content: "系统规则", source: "system"}),
            expect.objectContaining({type: "user", content: "开始分析", source: "model_input"}),
        ]);
    });

    it("message_update 原位覆盖流式 assistant，不追加重复气泡", () => {
        const start = {...base, seq: 1, kind: "runtime", event: {type: "message_start", turn: 1, message: assistant("")}} as AgentSessionEvent;
        const update = {...base, seq: 2, kind: "runtime", event: {type: "message_update", turn: 1, message: assistant("正在输出")}} as AgentSessionEvent;
        const messages = applyAgentEvent(applyAgentEvent([], start), update);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({content: "正在输出", status: "streaming"});
    });

    it("重试 attempt 的 message_start 原位清空上一 attempt 的流式输出", () => {
        const events = [
            {...base, seq: 1, kind: "runtime", event: {type: "message_start", turn: 1, message: assistant("")}},
            {...base, seq: 2, kind: "runtime", event: {type: "message_update", turn: 1, message: assistant("第一次输出")}},
            {...base, seq: 3, kind: "runtime", event: {type: "message_start", turn: 1, message: assistant("")}},
            {...base, seq: 4, kind: "runtime", event: {type: "message_update", turn: 1, message: assistant("第二次输出")}},
        ] as AgentSessionEvent[];
        const messages = events.reduce((current, event) => applyAgentEvent(current, event), [] as ReturnType<typeof messagesFromSnapshot>);

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({content: "第二次输出", status: "streaming"});
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
            activeWorkspace: null,
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

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({content: "准备修改", thinking: "先定位原句", tools: [{id: "t1", args: expect.stringContaining("oldText"), status: "success", result: "完成"}]});
    });

    it("刷新后保留完整分析报告供 Flow 展示", () => {
        const report = {score: 18, confidence: 0.82, conclusion: "存在两处明显模式", evidence: [], suggestions: ["改成具体动作"]};
        const snapshot: AgentSessionSnapshot = {
            sessionId: "s1",
            revisionId: "r1",
            profileKey: "llmlint.review",
            status: "idle",
            activeInvocation: null,
            activeWorkspace: null,
            invocations: [],
            entries: [{id: "report-1", invocationId: "i1", kind: "report", payload: {report}, createdAt: new Date(1).toISOString()}],
            report,
            hits: [],
            eventCursor: {eventEpoch: "e1", after: 1},
        };

        const messages = messagesFromSnapshot(snapshot);

        expect(messages[0]).toMatchObject({type: "report", content: "存在两处明显模式", report});
    });
});

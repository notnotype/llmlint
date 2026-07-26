import {describe, expect, it} from "vitest";
import {buildAgentFlowNodes, invocationErrorMessage, invocationPresentation, latestRetryableInvocation, toolPresentation} from "../web/app/utils/agent-chat-flow";
import type {AgentInvocationSnapshot} from "../web/shared/agent-harness";
import type {AgentChatMessage} from "../web/app/utils/agent-chat-projection";
import {ONE_CLICK_FIX_INSTRUCTION} from "../web/app/utils/agent-one-click-fix";

describe("Agent chat flow projection", () => {
    it("一键修到底按风险分层润色，并使用低惯用候选", () => {
        expect(ONE_CLICK_FIX_INSTRUCTION).toContain("强判别");
        expect(ONE_CLICK_FIX_INSTRUCTION).toContain("AI 敏感词");
        expect(ONE_CLICK_FIX_INSTRUCTION).toContain("酌情");
        expect(ONE_CLICK_FIX_INSTRUCTION).toContain("整段");
        expect(ONE_CLICK_FIX_INSTRUCTION).toContain("候选");
        expect(ONE_CLICK_FIX_INSTRUCTION).toContain("最不会优先选择");
        expect(ONE_CLICK_FIX_INSTRUCTION).toContain("自由选择");
        expect(ONE_CLICK_FIX_INSTRUCTION).toContain("安全机械修复已在启动前应用");
        expect(ONE_CLICK_FIX_INSTRUCTION).not.toContain("lint_fix");
        expect(ONE_CLICK_FIX_INSTRUCTION).not.toContain("全部消除");
        expect(ONE_CLICK_FIX_INSTRUCTION).not.toContain("严格按以下顺序");
    });

    it("按 Invocation 分段，并把 assistant tool 与连续 edit 投影为独立节点", () => {
        const messages: AgentChatMessage[] = [{
            id: "assistant-1",
            type: "assistant",
            content: "开始处理",
            thinking: "先定位原句",
            status: "done",
            invocationId: "invocation-1",
            tools: [{id: "tool-1", name: "replace", args: JSON.stringify({oldText: "很美", newText: "清亮"}), status: "success", result: "已替换"}],
        }, {
            id: "edit-1",
            type: "edit",
            content: "",
            status: "done",
            invocationId: "invocation-1",
            edit: {oldText: "很美", newText: "清亮", reason: "减少空泛形容"},
        }, {
            id: "edit-2",
            type: "edit",
            content: "",
            status: "done",
            invocationId: "invocation-1",
            edit: {oldText: "很安静", newText: "只剩虫鸣", reason: null},
        }];

        const nodes = buildAgentFlowNodes(messages, [invocation({id: "invocation-1"})]);

        expect(nodes.map(node => node.kind)).toEqual(["invocation", "message", "tool", "edits"]);
        expect(nodes[2]).toMatchObject({kind: "tool", tool: {id: "tool-1", name: "replace"}});
        expect(nodes[3]).toMatchObject({kind: "edits", edits: [{oldText: "很美"}, {oldText: "很安静"}]});
    });

    it("保留没有可见 timeline entry 的失败 Invocation", () => {
        const nodes = buildAgentFlowNodes([], [invocation({id: "failed-1", status: "failed", error: "provider unavailable"})]);

        expect(nodes).toEqual([{kind: "invocation", id: "invocation:failed-1", invocation: expect.objectContaining({status: "failed", error: "provider unavailable"})}]);
    });

    it("工具展示使用人类可读名称和紧凑摘要", () => {
        expect(toolPresentation({id: "edit-1", name: "edit", args: JSON.stringify({edits: [{oldText: "旧句", newText: "新句"}]}), status: "success"})).toMatchObject({kind: "edit"});
        expect(toolPresentation({id: "read-1", name: "read", args: JSON.stringify({offset: 21}), status: "running"})).toMatchObject({kind: "read", summary: "lines 21+"});
        expect(toolPresentation({id: "custom-1", name: "custom_tool", args: "{}", status: "running"})).toMatchObject({kind: "custom", fallbackLabel: "custom_tool"});
    });

    it("把 partial、失败和完整完成映射为稳定 UI 语义", () => {
        expect(invocationPresentation(invocation({result: {body: "新文", edits: [], partial: true}}))).toEqual({status: "partial", tone: "warning"});
        expect(invocationPresentation(invocation({status: "failed", error: "provider unavailable", result: null}))).toEqual({status: "failed", tone: "danger"});
        expect(invocationPresentation(invocation({result: {body: "新文", edits: [], partial: false}}))).toEqual({status: "completed", tone: "success"});
    });

    it("只有最新 Invocation 失败时才允许 retry", () => {
        const failed = invocation({id: "failed", status: "failed", result: null});
        const completed = invocation({id: "completed"});

        expect(latestRetryableInvocation([failed, completed])).toBeNull();
        expect(latestRetryableInvocation([completed, failed])?.id).toBe("failed");
    });

    it("把 provider length 失败解释为可重试的输出上限", () => {
        expect(invocationErrorMessage("model agent 轮终态失败（length（token 预算内没完成本轮）: text=）"))
            .toBe("模型本轮输出达到上限，尚未完成工具调用。可以重试本轮。");
        expect(invocationErrorMessage("provider unavailable")).toBe("provider unavailable");
    });
});

/** 构造 flow 测试所需的最小 Invocation snapshot。 */
function invocation(overrides: Partial<AgentInvocationSnapshot>): AgentInvocationSnapshot {
    return {
        id: "invocation-1",
        mode: "prompt",
        phase: "optimize",
        status: "completed",
        turns: 2,
        error: null,
        createdAt: new Date(1).toISOString(),
        finishedAt: new Date(2).toISOString(),
        input: {mode: "prompt", phase: "optimize", revisionId: "revision-1", message: "改写", body: "旧文"},
        result: {body: "新文", edits: [], partial: false},
        terminationReason: "tool_terminate",
        ...overrides,
    };
}

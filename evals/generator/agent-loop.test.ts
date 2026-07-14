// agent-loop 循环骨架守门（bun:test）：注入假 callTurn 无网测——toolResult 回喂形态、finish 提前结束、
// natural-stop / max-turns 归类、连续 3 轮全错抛错、一轮多 toolCall 顺序执行。
import {test, expect} from "bun:test";
import {runAgentLoop, type AgentToolCall, type ToolExecution} from "./agent-loop";
import type {AssistantMessage, AgentTurnContext} from "./model-client";
import type {ResolvedModel} from "./config";

// callTurn 注入后 resolved 不被真实使用，最小假体即可。
const FAKE_MODEL = {modelKey: "fake", providerId: "fake"} as unknown as ResolvedModel;

/** 造一轮 assistant：给 calls 则 stopReason=toolUse，否则 stop+文本。 */
function assistantTurn(calls: Array<{id: string; name: string; arguments: Record<string, unknown>}>, text = ""): AssistantMessage {
    if (calls.length === 0) {
        return {content: [{type: "text", text}], stopReason: "stop", usage: {input: 10, output: 5}};
    }
    return {content: calls.map((call) => ({type: "toolCall", id: call.id, name: call.name, arguments: call.arguments})), stopReason: "toolUse", usage: {input: 10, output: 5}} as AssistantMessage;
}

/** 按脚本依次出牌的假 callTurn，同时记录每轮收到的 messages 快照长度。 */
function scriptedCallTurn(script: AssistantMessage[], seenContexts: AgentTurnContext[] = []) {
    let index = 0;
    return async (_resolved: ResolvedModel, context: AgentTurnContext): Promise<AssistantMessage> => {
        seenContexts.push({...context, messages: [...context.messages]});
        const next = script[index];
        index += 1;
        if (!next) {
            throw new Error("脚本耗尽");
        }
        return next;
    };
}

const OK_EXECUTE = (call: AgentToolCall): ToolExecution =>
    call.name === "finish" ? {content: "已结束", terminate: true} : {content: "已应用"};

test("finish 工具提前结束：stop=finish，toolResult 以正确形态回喂", async () => {
    const contexts: AgentTurnContext[] = [];
    const callTurn = scriptedCallTurn([
        assistantTurn([{id: "c1", name: "replace", arguments: {oldText: "a", newText: "b"}}]),
        assistantTurn([{id: "c2", name: "finish", arguments: {}}]),
    ], contexts);
    const result = await runAgentLoop(FAKE_MODEL, {system: "s", user: "u", tools: [], maxTurns: 5, maxTokensPerTurn: 100, execute: OK_EXECUTE, callTurn});
    expect(result.stop).toBe("finish");
    expect(result.turns).toBe(2);
    expect(result.toolCalls).toBe(2);
    // 第二轮收到的 messages：user + assistant1 + toolResult1
    const secondTurnMessages = contexts[1]!.messages as Array<Record<string, unknown>>;
    expect(secondTurnMessages.length).toBe(3);
    const toolResult = secondTurnMessages[2]!;
    expect(toolResult.role).toBe("toolResult");
    expect(toolResult.toolCallId).toBe("c1");
    expect(toolResult.toolName).toBe("replace");
    expect(toolResult.isError).toBe(false);
    expect((toolResult.content as Array<{type: string; text: string}>)[0]!.text).toBe("已应用");
});

test("stop + 无工具调用 → natural-stop（usage 累加）", async () => {
    const callTurn = scriptedCallTurn([
        assistantTurn([{id: "c1", name: "replace", arguments: {}}]),
        assistantTurn([], "改完了"),
    ]);
    const result = await runAgentLoop(FAKE_MODEL, {system: "s", user: "u", tools: [], maxTurns: 5, maxTokensPerTurn: 100, execute: OK_EXECUTE, callTurn});
    expect(result.stop).toBe("natural-stop");
    expect(result.turns).toBe(2);
    expect(result.usage).toEqual({input: 20, output: 10});
});

test("轮数耗尽 → max-turns", async () => {
    const turn = assistantTurn([{id: "c", name: "replace", arguments: {}}]);
    const callTurn = scriptedCallTurn([turn, turn, turn]);
    const result = await runAgentLoop(FAKE_MODEL, {system: "s", user: "u", tools: [], maxTurns: 3, maxTokensPerTurn: 100, execute: OK_EXECUTE, callTurn});
    expect(result.stop).toBe("max-turns");
    expect(result.turns).toBe(3);
});

test("连续 3 轮工具全错 → 抛错止损；错误 toolResult 带 isError", async () => {
    const contexts: AgentTurnContext[] = [];
    const turn = assistantTurn([{id: "c", name: "replace", arguments: {}}]);
    const callTurn = scriptedCallTurn([turn, turn, turn, turn], contexts);
    const failExecute = (): ToolExecution => ({content: "未找到", isError: true});
    await expect(runAgentLoop(FAKE_MODEL, {system: "s", user: "u", tools: [], maxTurns: 10, maxTokensPerTurn: 100, execute: failExecute, callTurn}))
        .rejects.toThrow("死循环");
    const secondTurnMessages = contexts[1]!.messages as Array<Record<string, unknown>>;
    expect(secondTurnMessages[2]!.isError).toBe(true);
});

test("一轮多个 toolCall 顺序执行，各得一条 toolResult；中间夹错不触发死循环计数", async () => {
    const contexts: AgentTurnContext[] = [];
    const callTurn = scriptedCallTurn([
        assistantTurn([
            {id: "c1", name: "replace", arguments: {which: 1}},
            {id: "c2", name: "unknown", arguments: {}},
            {id: "c3", name: "replace", arguments: {which: 3}},
        ]),
        assistantTurn([{id: "c4", name: "finish", arguments: {}}]),
    ], contexts);
    const order: string[] = [];
    const execute = (call: AgentToolCall): ToolExecution => {
        order.push(call.id);
        if (call.name === "unknown") {
            return {content: "未知工具", isError: true};
        }
        return OK_EXECUTE(call);
    };
    const result = await runAgentLoop(FAKE_MODEL, {system: "s", user: "u", tools: [], maxTurns: 5, maxTokensPerTurn: 100, execute, callTurn});
    expect(order).toEqual(["c1", "c2", "c3", "c4"]);
    expect(result.stop).toBe("finish");
    expect(result.toolCalls).toBe(4);
    // 第二轮 messages：user + assistant + 3 条 toolResult
    expect(contexts[1]!.messages.length).toBe(5);
});

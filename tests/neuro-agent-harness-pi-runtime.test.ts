import {describe, expect, it} from "vitest";
import type {ModelRuntimeEvent} from "@notnotype/neuro-agent-harness";
import {LlmlintPiModelRuntime} from "../web/server/agent/neuro-agent-harness/pi-runtime";
import type {ResolvedModel} from "../evals/generator/config";

const model: ResolvedModel = {
    modelKey: "test/model",
    providerId: "test",
    modelId: "model",
    name: "model",
    baseURL: "http://localhost",
    apiKey: "test",
    contextWindow: 1000,
    maxTokens: 100,
    timeoutMs: 1000,
    compat: undefined,
};

describe("llmlint Pi ModelRuntime Adapter", () => {
    it("转换 Core messages/tools，并按模型上限和 64k cap 计算单轮预算", async () => {
        const events: ModelRuntimeEvent[] = [];
        let receivedMaxTokens = 0;
        const runtime = new LlmlintPiModelRuntime({
            resolveModel: () => model,
            runTurn: async (_model, context, maxTokens) => {
                receivedMaxTokens = maxTokens;
                expect(context.messages).toEqual([{role: "user", content: [{type: "text", text: "hello"}], timestamp: 1}]);
                expect(context.tools[0]).toMatchObject({name: "replace"});
                await context.onEvent?.({type: "start", partial: assistant([])});
                await context.onEvent?.({type: "text_delta", contentIndex: 0, delta: "完成", partial: assistant([{type: "text", text: "完成"}])});
                return {content: [{type: "thinking", thinking: "先检查"}, {type: "text", text: "完成"}], usage: {input: 2, output: 3}};
            },
        });

        const result = await runtime.runTurn({
            profileKey: "llmlint.review",
            turn: 1,
            systemPrompt: "system",
            messages: [{role: "user", content: "hello", timestamp: 1}],
            tools: [{name: "replace", description: "replace", parameters: {type: "object"}}],
            modelConfig: {modelKey: "test/model", maxTokensCap: 65_536},
            signal: new AbortController().signal,
            onEvent: event => { events.push(event); },
        });

        expect(events).toEqual([{type: "message_start"}, {type: "text_delta", delta: "完成"}]);
        expect(result.message.content).toEqual([{type: "thinking", thinking: "先检查"}, {type: "text", text: "完成"}]);
        expect(result.message.usage).toEqual({input: 2, output: 3, total: 5});
        expect(receivedMaxTokens).toBe(100);
    });

    it.each([
        {modelMax: 65_536, expected: 65_536},
        {modelMax: 200_000, expected: 65_536},
    ])("模型 maxTokens=$modelMax 时使用 $expected", async ({modelMax, expected}) => {
        let received = 0;
        const runtime = new LlmlintPiModelRuntime({
            resolveModel: () => ({...model, maxTokens: modelMax}),
            runTurn: async (_model, _context, maxTokens) => {
                received = maxTokens;
                return {content: [{type: "text", text: "完成"}]};
            },
        });

        await runtime.runTurn({
            profileKey: "llmlint.review",
            turn: 1,
            systemPrompt: "system",
            messages: [{role: "user", content: "hello", timestamp: 1}],
            tools: [],
            modelConfig: {modelKey: "test/model", maxTokensCap: 65_536},
            signal: new AbortController().signal,
        });

        expect(received).toBe(expected);
    });

    it("历史 4000 token length 形状在新预算下能完成工具调用", async () => {
        const runtime = new LlmlintPiModelRuntime({
            resolveModel: () => ({...model, maxTokens: 200_000}),
            runTurn: async (_model, _context, maxTokens) => {
                if (maxTokens <= 4000) throw new Error("length（token 预算内没完成本轮）");
                return {content: [{type: "toolCall", id: "read-1", name: "read", arguments: {lineNumbers: true}}]};
            },
        });

        const result = await runtime.runTurn({
            profileKey: "llmlint.review",
            turn: 1,
            systemPrompt: "system",
            messages: [{role: "user", content: "请先读取正文", timestamp: 1}],
            tools: [{name: "read", description: "读取正文", parameters: {type: "object"}}],
            modelConfig: {modelKey: "test/model", maxTokensCap: 65_536},
            signal: new AbortController().signal,
        });

        expect(result.message.content).toMatchObject([{type: "toolCall", call: {name: "read"}}]);
    });
});

function assistant(content: Array<{type: "text"; text: string}>) {
    return {
        role: "assistant" as const,
        content,
        api: "openai-completions" as const,
        provider: "test" as const,
        model: "model",
        usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
        stopReason: "stop" as const,
        timestamp: 1,
    };
}

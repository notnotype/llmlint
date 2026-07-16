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
    it("转换 Core messages/tools，并投影 provider-neutral stream event", async () => {
        const events: ModelRuntimeEvent[] = [];
        const runtime = new LlmlintPiModelRuntime({
            resolveModel: () => model,
            runTurn: async (_model, context) => {
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
            modelConfig: {modelKey: "test/model", maxTokensPerTurn: 100},
            signal: new AbortController().signal,
            onEvent: event => { events.push(event); },
        });

        expect(events).toEqual([{type: "message_start"}, {type: "text_delta", delta: "完成"}]);
        expect(result.message.content).toEqual([{type: "thinking", thinking: "先检查"}, {type: "text", text: "完成"}]);
        expect(result.message.usage).toEqual({input: 2, output: 3, total: 5});
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

import {describe, expect, it} from "vitest";
import {NeuroAgentHarness, ProfileRegistry, type JsonObject} from "@notnotype/neuro-agent-harness";
import {MemorySessionStore} from "@notnotype/neuro-agent-harness/storage/memory";
import {ScriptedModelRuntime} from "@notnotype/neuro-agent-harness/testing";
import {createLlmlintProfile, type LlmlintOptimizeResult, type LlmlintSessionInitial} from "../web/server/agent/neuro-agent-harness/profile";
import type {LlmlintModelConfig} from "../web/server/agent/neuro-agent-harness/pi-runtime";
import {llmlintAnalysisContext} from "../web/server/agent/neuro-agent-harness/analysis-context";

describe("llmlint NeuroAgentHarness Profile", () => {
    it("通过 replace/finish 完成 optimize，并持久化编辑事实", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            (request) => {
                const user = request.messages.findLast((message) => message.role === "user");
                expect(user?.role === "user" ? user.content : "").toContain("用户要求：改得具体一些");
                return {message: {
                    role: "assistant",
                    content: [{type: "toolCall", call: {id: "replace-1", name: "replace", arguments: {oldText: "很美", newText: "清亮", reason: "减少空泛形容"}}}],
                    timestamp: 1,
                }};
            },
            {
                message: {
                    role: "assistant",
                    content: [{type: "toolCall", call: {id: "finish-1", name: "finish", arguments: {summary: "收紧形容"}}}],
                    timestamp: 2,
                },
            },
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-1"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider()]});
        await harness.createSession({
            profileKey: "llmlint.review",
            initial: {revisionId: "revision-1", userId: 1},
            hostContext: {revisionId: "revision-1", userId: 1},
        });

        const handle = await harness.invoke({
            sessionId: "session-1",
            payload: {mode: "prompt", phase: "optimize", message: "改得具体一些", body: "月光很美。"},
        });
        const result = await handle.result();
        expect(result.status).toBe("completed");
        expect(result.output).toEqual({
            body: "月光清亮。",
            edits: [{oldText: "很美", newText: "清亮", reason: "减少空泛形容"}],
            partial: false,
            summary: "收紧形容",
        } satisfies LlmlintOptimizeResult);

        const snapshot = await harness.snapshot("session-1");
        expect(snapshot.session.entries.some((entry) => entry.kind === "llmlint.edit")).toBe(true);
        expect(snapshot.session.invocations[0]?.input).toMatchObject({phase: "optimize", body: "月光很美。"} as JsonObject);
    });

    it("拒绝已失效的选区快照", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-2"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider()]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-2", userId: 2}, hostContext: {revisionId: "revision-2", userId: 2}});
        const handle = await harness.invoke({
            sessionId: "session-2",
            payload: {mode: "prompt", phase: "optimize", message: "改写", body: "正文已经变化", selection: {from: 0, to: 2, text: "旧文"}},
        });
        const result = await handle.result();
        expect(result.status).toBe("failed");
        expect(result.error?.message).toContain("选区已变化");
    });

    it("取消时返回已经完成的部分改写", async () => {
        let secondTurnStarted!: () => void;
        const secondTurn = new Promise<void>((resolve) => { secondTurnStarted = resolve; });
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "replace-1", name: "replace", arguments: {oldText: "旧", newText: "新"}}}], timestamp: 1}},
            async (request) => {
                secondTurnStarted();
                return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true}));
            },
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-3"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider()]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-3", userId: 3}, hostContext: {revisionId: "revision-3", userId: 3}});
        const handle = await harness.invoke({sessionId: "session-3", payload: {mode: "prompt", phase: "optimize", message: "改写", body: "旧文"}});
        await secondTurn;
        handle.abort();

        const result = await handle.result();
        expect(result.status).toBe("aborted");
        expect(result.output).toEqual({body: "新文", edits: [{oldText: "旧", newText: "新", reason: null}], partial: true, summary: "用户取消，保留已完成修改"});
    });

    it("自然停止但已有编辑时接受部分改写", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "replace-1", name: "replace", arguments: {oldText: "旧", newText: "新"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "text", text: "已经改完。"}], timestamp: 2}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-natural-stop"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider()]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-natural-stop", userId: 3}, hostContext: {revisionId: "revision-natural-stop", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-natural-stop", payload: {mode: "prompt", phase: "optimize", message: "改写", body: "旧文"}})).result();

        expect(result.status).toBe("completed");
        expect(result.terminationReason).toBe("natural_stop");
        expect(result.output).toEqual({body: "新文", edits: [{oldText: "旧", newText: "新", reason: null}], partial: true, summary: "模型自然停止，保留已完成修改"});
    });

    it("maxTurns 耗尽但已有编辑时接受部分改写", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>(Array.from({length: 64}, (_, index) => ({
            message: {
                role: "assistant" as const,
                content: [{type: "toolCall" as const, call: {id: `replace-${index}`, name: "replace", arguments: {oldText: `v${index}`, newText: `v${index + 1}`}}}],
                timestamp: index + 1,
            },
        })));
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-max-turns"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider()]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-max-turns", userId: 3}, hostContext: {revisionId: "revision-max-turns", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-max-turns", payload: {mode: "prompt", phase: "optimize", message: "改写", body: "v0"}})).result();

        expect(result.status).toBe("completed");
        expect(result.terminationReason).toBe("max_turns");
        expect(result.output).toMatchObject({body: "v64", partial: true, summary: "达到最大轮次，保留已完成修改"});
    });

    it("provider 失败但已有编辑时保留部分改写且状态仍为 failed", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "replace-1", name: "replace", arguments: {oldText: "旧", newText: "新"}}}], timestamp: 1}},
            () => { throw new Error("provider unavailable"); },
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-provider-failure"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider()]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-provider-failure", userId: 3}, hostContext: {revisionId: "revision-provider-failure", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-provider-failure", payload: {mode: "prompt", phase: "optimize", message: "改写", body: "旧文"}})).result();

        expect(result.status).toBe("failed");
        expect(result.error?.message).toContain("provider unavailable");
        expect(result.output).toEqual({body: "新文", edits: [{oldText: "旧", newText: "新", reason: null}], partial: true, summary: "运行失败，保留已完成修改"});
    });

    it("自然停止且零编辑时不制造成功改写", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "text", text: "无需修改。"}], timestamp: 1}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-zero-edits"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider()]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-zero-edits", userId: 3}, hostContext: {revisionId: "revision-zero-edits", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-zero-edits", payload: {mode: "prompt", phase: "optimize", message: "改写", body: "原文"}})).result();

        expect(result.status).toBe("failed");
        expect(result.output).toBeUndefined();
    });

    it("通过 context/chunk/hit/report 工具完成 analysis 结构化输出", async () => {
        const body = "这一段只剩空泛的未来。";
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "context", name: "get_lint_context", arguments: {}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "chunk", name: "read_document_chunk", arguments: {index: 0}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "hit", name: "record_rule_hit", arguments: {ruleId: "ending", quote: "空泛的未来", reason: "抽象升华"}}}], timestamp: 3}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report", name: "report_result", arguments: {confidence: 0.9, conclusion: "存在机械升华", suggestions: ["改成具体动作"]}}}], timestamp: 4}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-4"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({
            store,
            profiles,
            model,
            capabilities: [{
                capability: llmlintAnalysisContext,
                open: () => ({load: async () => ({
                    body,
                    chunks: [{start: 0, end: body.length, text: body}],
                    scanStats: {hitCount: 1, docScore: 2},
                    ruleIds: new Set(["ending"]),
                    ruleLevels: new Map([["ending", "medium" as const]]),
                    rulesText: "- ending：机械升华",
                })}),
            }],
        });
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-4", userId: 4}, hostContext: {revisionId: "revision-4", userId: 4}});
        const handle = await harness.invoke({sessionId: "session-4", payload: {mode: "prompt", phase: "analysis", body}});
        const result = await handle.result();

        expect(result.status).toBe("completed");
        expect(result.output).toMatchObject({
            model: "test/model",
            promptVersion: "llm-rules-agent-v4",
            hits: [{ruleId: "ending", quote: "空泛的未来"}],
            report: {confidence: 0.9, conclusion: "存在机械升华"},
        });
        const snapshot = await harness.snapshot("session-4");
        expect(snapshot.session.entries.some((entry) => entry.kind === "llmlint.report")).toBe(true);
    });
});

function unusedAnalysisProvider() {
    return {
        capability: llmlintAnalysisContext,
        open: () => ({load: async () => { throw new Error("optimize 不应加载 analysis context"); }}),
    };
}

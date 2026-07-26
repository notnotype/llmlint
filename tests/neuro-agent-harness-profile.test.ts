import {describe, expect, it} from "vitest";
import {NeuroAgentHarness, ProfileRegistry, type JsonObject} from "@notnotype/neuro-agent-harness";
import {MemorySessionStore} from "@notnotype/neuro-agent-harness/storage/memory";
import {ScriptedModelRuntime} from "@notnotype/neuro-agent-harness/testing";
import {createLlmlintProfile, type LlmlintOptimizeResult, type LlmlintSessionInitial} from "../web/server/agent/neuro-agent-harness/profile";
import type {LlmlintModelConfig} from "../web/server/agent/neuro-agent-harness/pi-runtime";
import {llmlintAnalysisContext} from "../web/server/agent/neuro-agent-harness/analysis-context";
import {llmlintRevisionTextSource} from "../web/server/agent/neuro-agent-harness/revision-text-workspace";

describe("llmlint NeuroAgentHarness Profile", () => {
    it("整篇 optimize 不把正文塞进模型输入，正文只通过 read 获取", async () => {
        const body = "不会直接进入模型输入的正文";
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            (request) => {
                expect(request.systemPrompt).toContain("强判别规则必须处理");
                expect(request.systemPrompt).toContain("弱判别规则由你结合语境判断");
                expect(request.systemPrompt).toContain("完整句子或段落");
                expect(request.systemPrompt).toContain("内部生成至少三个");
                expect(request.systemPrompt).toContain("最不会优先选择");
                expect(request.systemPrompt).toContain("工具没有固定调用顺序");
                const user = request.messages.findLast((message) => message.role === "user");
                expect(user?.role === "user" ? user.content : "").not.toContain(body);
                return {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read", name: "read", arguments: {lineNumbers: true}}}], timestamp: 1}};
            },
            (request) => {
                const result = request.messages.findLast((message) => message.role === "toolResult");
                expect(result?.role === "toolResult" ? result.content : "").toContain(body);
                return {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit", name: "edit", arguments: {edits: [{oldText: "正文", newText: "文本"}]}}}], timestamp: 2}};
            },
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "完成"}}}], timestamp: 3}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-read-only"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider(body)]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-read", userId: 1}, hostContext: {revisionId: "revision-read", userId: 1}});

        const result = await (await harness.invoke({sessionId: "session-read-only", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-read", message: "优化", body}})).result();

        expect(result.status).toBe("completed");
    });

    it("风险润色 objective 不向模型暴露 lint_fix，正文只由 edit 继续修改", async () => {
        const body = "旧文";
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            (request) => {
                expect(request.systemPrompt).not.toContain("lint_fix");
                expect(request.tools.map((tool) => tool.name)).toContain("read");
                expect(request.tools.map((tool) => tool.name)).toContain("edit");
                expect(request.tools.map((tool) => tool.name)).not.toContain("lint_fix");
                return {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit", name: "edit", arguments: {edits: [{oldText: "旧文", newText: "新文"}]}}}], timestamp: 1}};
            },
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "完成风险润色"}}}], timestamp: 2}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-polish-tools"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider(body)]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-polish-tools", userId: 1}, hostContext: {revisionId: "revision-polish-tools", userId: 1}});

        const result = await (await harness.invoke({sessionId: "session-polish-tools", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-polish-tools", objective: "polish_ai_risk", message: "一键修到底", body}})).result();

        expect(result.status).toBe("completed");
        expect(result.output).toMatchObject({body: "新文"});
    });

    it("选区 optimize 只在模型输入中暴露选区，不附加整篇正文", async () => {
        const body = "前文选区后文";
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            (request) => {
                const user = request.messages.findLast((message) => message.role === "user");
                const content = user?.role === "user" ? user.content : "";
                expect(content).toContain("选区");
                expect(content).not.toContain("前文");
                expect(content).not.toContain("后文");
                return {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit", name: "edit", arguments: {edits: [{oldText: "选区", newText: "片段"}]}}}], timestamp: 1}};
            },
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "完成选区修改"}}}], timestamp: 2}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-selection-input"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider(body)]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-selection", userId: 1}, hostContext: {revisionId: "revision-selection", userId: 1}});

        const result = await (await harness.invoke({sessionId: "session-selection-input", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-selection", message: "优化选区", body, selection: {from: 2, to: 4, text: "选区"}}})).result();

        expect(result.output).toMatchObject({body: "前文片段后文"});
    });

    it("lint_check 向模型公开强判别、AI 敏感词与弱判别优先级", async () => {
        const body = "不是因为天气，而是因为心情。\n他笑了一声。\n他的脊柱发紧。";
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}},
            (request) => {
                const toolResult = request.messages.findLast((message) => message.role === "toolResult");
                const content = toolResult?.role === "toolResult" ? toolResult.content : "";
                expect(content).toContain("必修：强判别");
                expect(content).toContain("必修：AI 敏感词");
                expect(content).toContain("酌情：弱判别");
                return {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit", name: "edit", arguments: {edits: [{oldText: body, newText: "雨停后，他终于笑了。"}]}}}], timestamp: 2}};
            },
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "完成风险润色"}}}], timestamp: 3}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-priority"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider(body)]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-priority", userId: 1}, hostContext: {revisionId: "revision-priority", userId: 1}});

        const result = await (await harness.invoke({sessionId: "session-priority", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-priority", message: "润色高风险段落", body}})).result();

        expect(result.status).toBe("completed");
    });

    it("通过 edit/finish 完成 optimize，并持久化编辑事实", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            (request) => {
                const user = request.messages.findLast((message) => message.role === "user");
                expect(user?.role === "user" ? user.content : "").toContain("用户要求：改得具体一些");
                return {message: {
                    role: "assistant",
                    content: [{type: "toolCall", call: {id: "edit-1", name: "edit", arguments: {edits: [{oldText: "很美", newText: "清亮", reason: "减少空泛形容"}]}}}],
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
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({
            profileKey: "llmlint.review",
            initial: {revisionId: "revision-1", userId: 1},
            hostContext: {revisionId: "revision-1", userId: 1},
        });

        const handle = await harness.invoke({
            sessionId: "session-1",
            payload: {mode: "prompt", phase: "optimize", revisionId: "revision-1", message: "改得具体一些", body: "月光很美。"},
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
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-2", userId: 2}, hostContext: {revisionId: "revision-2", userId: 2}});
        const handle = await harness.invoke({
            sessionId: "session-2",
            payload: {mode: "prompt", phase: "optimize", revisionId: "revision-2", message: "改写", body: "正文已经变化", selection: {from: 0, to: 2, text: "旧文"}},
        });
        const result = await handle.result();
        expect(result.status).toBe("failed");
        expect(result.error?.message).toContain("选区已变化");
    });

    it("取消时返回已经完成的部分改写", async () => {
        let secondTurnStarted!: () => void;
        const secondTurn = new Promise<void>((resolve) => { secondTurnStarted = resolve; });
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit-1", name: "edit", arguments: {edits: [{oldText: "旧", newText: "新"}]}}}], timestamp: 1}},
            async (request) => {
                secondTurnStarted();
                return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true}));
            },
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-3"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-3", userId: 3}, hostContext: {revisionId: "revision-3", userId: 3}});
        const handle = await harness.invoke({sessionId: "session-3", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-3", message: "改写", body: "旧文"}});
        await secondTurn;
        handle.abort();

        const result = await handle.result();
        expect(result.status).toBe("aborted");
        expect(result.output).toEqual({body: "新文", edits: [{oldText: "旧", newText: "新", reason: null}], partial: true, summary: "用户取消，保留已完成修改"});
    });

    it("lint_fix 后取消时从 durable workspace 恢复无歧义部分结果", async () => {
        let secondTurnStarted!: () => void;
        const secondTurn = new Promise<void>((resolve) => { secondTurnStarted = resolve; });
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "fix-1", name: "lint_fix", arguments: {}}}], timestamp: 1}},
            async (request) => {
                secondTurnStarted();
                return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true}));
            },
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-auto-abort"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-auto", userId: 3}, hostContext: {revisionId: "revision-auto", userId: 3}});
        const handle = await harness.invoke({sessionId: "session-auto-abort", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-auto", message: "机械清理", body: "甲……...乙———"}});
        await secondTurn;
        handle.abort();

        const result = await handle.result();
        expect(result.status).toBe("aborted");
        expect(result.output).toMatchObject({body: "甲……乙——", partial: true});
        expect((await harness.snapshot("session-auto-abort")).session.entries.some((entry) => entry.kind === "llmlint.workspace")).toBe(true);
    });

    it("lint_fix 可以一次持久化超过 64 处真实修改", async () => {
        const body = Array.from({length: 70}, () => "……...").join("甲");
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "fix", name: "lint_fix", arguments: {}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "机械规则已修复"}}}], timestamp: 2}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-many-edits"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider(body)]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-many-edits", userId: 3}, hostContext: {revisionId: "revision-many-edits", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-many-edits", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-many-edits", message: "机械清理", body}})).result();

        expect(result.status).toBe("completed");
        expect((result.output as LlmlintOptimizeResult).edits).toHaveLength(70);
    });

    it("自然停止但已有编辑时接受部分改写", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit-1", name: "edit", arguments: {edits: [{oldText: "旧", newText: "新"}]}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "text", text: "已经改完。"}], timestamp: 2}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-natural-stop"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-natural-stop", userId: 3}, hostContext: {revisionId: "revision-natural-stop", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-natural-stop", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-natural-stop", message: "改写", body: "旧文"}})).result();

        expect(result.status).toBe("completed");
        expect(result.terminationReason).toBe("natural_stop");
        expect(result.output).toEqual({body: "新文", edits: [{oldText: "旧", newText: "新", reason: null}], partial: true, summary: "模型自然停止，保留已完成修改"});
    });

    it("maxTurns 耗尽但已有编辑时接受部分改写", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>(Array.from({length: 64}, (_, index) => ({
            message: {
                role: "assistant" as const,
                content: [{type: "toolCall" as const, call: {id: `edit-${index}`, name: "edit", arguments: {edits: [{oldText: `v${index}`, newText: `v${index + 1}`}]}}}],
                timestamp: index + 1,
            },
        })));
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-max-turns"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-max-turns", userId: 3}, hostContext: {revisionId: "revision-max-turns", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-max-turns", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-max-turns", message: "改写", body: "v0"}})).result();

        expect(result.status).toBe("completed");
        expect(result.terminationReason).toBe("max_turns");
        expect(result.output).toMatchObject({body: "v64", partial: true, summary: "达到最大轮次，保留已完成修改"});
    });

    it("provider 失败但已有编辑时保留部分改写且状态仍为 failed", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit-1", name: "edit", arguments: {edits: [{oldText: "旧", newText: "新"}]}}}], timestamp: 1}},
            () => { throw new Error("provider unavailable"); },
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-provider-failure"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-provider-failure", userId: 3}, hostContext: {revisionId: "revision-provider-failure", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-provider-failure", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-provider-failure", message: "改写", body: "旧文"}})).result();

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
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-zero-edits", userId: 3}, hostContext: {revisionId: "revision-zero-edits", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-zero-edits", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-zero-edits", message: "改写", body: "原文"}})).result();

        expect(result.status).toBe("failed");
        expect(result.output).toBeUndefined();
    });

    it("finish 不能把零编辑包装为成功改写", async () => {
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "无需修改"}}}], timestamp: 1}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-zero-finish"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: profileCapabilities()});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-zero", userId: 3}, hostContext: {revisionId: "revision-zero", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-zero-finish", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-zero", message: "检查", body: "原文"}})).result();

        expect(result.status).toBe("failed");
        expect(result.output).toBeUndefined();
    });

    it("风险润色目标允许 edit 作为第一项工具", async () => {
        const calls: Array<readonly [string, JsonObject]> = [
            ["edit", {edits: [{oldText: "！！", newText: "！", reason: "消除重复标点规则"}]}],
            ["finish", {summary: "规则已清零"}],
        ];
        const model = new ScriptedModelRuntime<LlmlintModelConfig>(calls.map(([name, argumentsValue], index) => ({
            message: {role: "assistant" as const, content: [{type: "toolCall" as const, call: {id: `${name}-${index}`, name, arguments: argumentsValue}}], timestamp: index + 1},
        })));
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-full-repair"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider("正文！！")]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-full", userId: 3}, hostContext: {revisionId: "revision-full", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-full-repair", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-full", objective: "polish_ai_risk", message: "一键修到底", body: "正文！！"}})).result();

        expect(result.status).toBe("completed");
        expect(result.output).toMatchObject({body: "正文！", partial: false});
    });

    it("风险润色目标仍有强判别命中时拒绝 finish，修复后可完成", async () => {
        const body = "不是因为天气，而是因为心情。旧字";
        const calls: Array<readonly [string, JsonObject]> = [
            ["edit", {edits: [{oldText: "旧字", newText: "新字"}]}],
            ["finish", {summary: "尚未处理强判别"}],
            ["edit", {edits: [{oldText: "不是因为天气，而是因为心情。", newText: "雨停了，他的心情仍没好转。"}]}],
            ["finish", {summary: "已处理强判别"}],
        ];
        const model = new ScriptedModelRuntime<LlmlintModelConfig>(calls.map(([name, argumentsValue], index) => ({
            message: {role: "assistant" as const, content: [{type: "toolCall" as const, call: {id: `${name}-${index}`, name, arguments: argumentsValue}}], timestamp: index + 1},
        })));
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-result-gate"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider(body)]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-gate", userId: 3}, hostContext: {revisionId: "revision-gate", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-result-gate", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-gate", objective: "polish_ai_risk", message: "一键修到底", body}})).result();

        expect(result.status).toBe("completed");
        expect(result.output).toMatchObject({body: "雨停了，他的心情仍没好转。新字"});
        const snapshot = await harness.snapshot("session-result-gate");
        expect(snapshot.session.entries.some((entry) => entry.kind === "agent.message" && JSON.stringify(entry.payload).includes("必修规则尚未处理"))).toBe(true);
    });

    it("风险润色目标仍有 AI 敏感词时拒绝 finish，改成语境化表达后可完成", async () => {
        const body = "他的脊柱发紧。旧字";
        const calls: Array<readonly [string, JsonObject]> = [
            ["edit", {edits: [{oldText: "旧字", newText: "新字"}]}],
            ["finish", {summary: "尚未处理敏感词"}],
            ["edit", {edits: [{oldText: "脊柱", newText: "后背"}]}],
            ["finish", {summary: "已按语境处理敏感词"}],
        ];
        const model = new ScriptedModelRuntime<LlmlintModelConfig>(calls.map(([name, argumentsValue], index) => ({
            message: {role: "assistant" as const, content: [{type: "toolCall" as const, call: {id: `${name}-${index}`, name, arguments: argumentsValue}}], timestamp: index + 1},
        })));
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-vocabulary-gate"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider(body)]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-vocabulary", userId: 3}, hostContext: {revisionId: "revision-vocabulary", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-vocabulary-gate", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-vocabulary", objective: "polish_ai_risk", message: "一键修到底", body}})).result();

        expect(result.status).toBe("completed");
        expect(result.output).toMatchObject({body: "他的后背发紧。新字"});
    });

    it("风险润色目标允许按语境保留弱判别和 LLM review 命中", async () => {
        const body = "他笑了一声。甲句。旧字";
        const calls: Array<readonly [string, JsonObject]> = [
            ["edit", {edits: [{oldText: "旧字", newText: "新字"}]}],
            ["finish", {summary: "保留符合语境的弱判别表达"}],
        ];
        const model = new ScriptedModelRuntime<LlmlintModelConfig>(calls.map(([name, argumentsValue], index) => ({
            message: {role: "assistant" as const, content: [{type: "toolCall" as const, call: {id: `${name}-${index}`, name, arguments: argumentsValue}}], timestamp: index + 1},
        })));
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-llm-gate"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({store, profiles, model, capabilities: [unusedAnalysisProvider(), revisionProvider(body, [{ruleId: "llm-rule", quote: "甲句", reason: "测试", span: {start: 6, end: 8}}])]});
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-llm-gate", userId: 3}, hostContext: {revisionId: "revision-llm-gate", userId: 3}});

        const result = await (await harness.invoke({sessionId: "session-llm-gate", payload: {mode: "prompt", phase: "optimize", revisionId: "revision-llm-gate", objective: "polish_ai_risk", message: "一键修到底", body}})).result();

        expect(result.status).toBe("completed");
        expect(result.output).toMatchObject({body: "他笑了一声。甲句。新字"});
    });

    it("通过 lint/read/hit/report 工具完成 analysis 结构化输出", async () => {
        const body = "这一段只剩空泛的未来。";
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            (request) => {
                expect(request.systemPrompt).toContain("判定标准是权威合同");
                expect(request.systemPrompt).toContain("高召回策略");
                expect(request.systemPrompt).toContain("不得凭主观感觉漏报");
                return {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}};
            },
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read", name: "read", arguments: {lineNumbers: true}}}], timestamp: 2}},
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
            }, revisionProvider(body)],
        });
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-4", userId: 4}, hostContext: {revisionId: "revision-4", userId: 4}});
        const handle = await harness.invoke({sessionId: "session-4", payload: {mode: "prompt", phase: "analysis", revisionId: "revision-4"}});
        const result = await handle.result();

        expect(result.status).toBe("completed");
        expect(result.output).toMatchObject({
            model: "test/model",
            promptVersion: "llm-rules-agent-v6",
            hits: [{ruleId: "ending", quote: "空泛的未来"}],
            report: {confidence: 0.9, conclusion: "存在机械升华"},
        });
        const snapshot = await harness.snapshot("session-4");
        expect(snapshot.session.entries.some((entry) => entry.kind === "llmlint.report")).toBe(true);
    });

    it("超长单行只读首个分片时不能提交 analysis 报告", async () => {
        const body = "中".repeat(22_000);
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read-first", name: "read", arguments: {offset: 1, limit: 1, lineNumbers: true}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report-early", name: "report_result", arguments: {confidence: 1, conclusion: "过早提交", suggestions: []}}}], timestamp: 3}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read-rest", name: "read", arguments: {offset: 1, limit: 1, characterOffset: 20_000, lineNumbers: true}}}], timestamp: 4}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report-final", name: "report_result", arguments: {confidence: 1, conclusion: "全文已读", suggestions: []}}}], timestamp: 5}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-long-line"});
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
                    scanStats: {hitCount: 0, docScore: 0},
                    ruleIds: new Set<string>(),
                    ruleLevels: new Map(),
                    rulesText: "无",
                })}),
            }, revisionProvider(body)],
        });
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-long-line", userId: 5}, hostContext: {revisionId: "revision-long-line", userId: 5}});

        const result = await (await harness.invoke({sessionId: "session-long-line", payload: {mode: "prompt", phase: "analysis", revisionId: "revision-long-line"}})).result();

        expect(result.status).toBe("completed");
        expect(model.requests).toHaveLength(5);
        expect(result.output).toMatchObject({report: {conclusion: "全文已读"}});
    }, 15_000);

    it("Analysis 乱序分页时必须覆盖每一行才能提交报告", async () => {
        const body = "第一行\n\n第三行";
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read-last", name: "read", arguments: {offset: 3, limit: 1}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report-early", name: "report_result", arguments: {confidence: 1, conclusion: "跳行提交", suggestions: []}}}], timestamp: 3}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read-first", name: "read", arguments: {offset: 1, limit: 2}}}], timestamp: 4}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report-final", name: "report_result", arguments: {confidence: 1, conclusion: "逐行完成", suggestions: []}}}], timestamp: 5}},
        ]);
        const store = new MemorySessionStore<string, LlmlintSessionInitial>({idKind: "custom", allocateId: () => "session-line-coverage"});
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const harness = new NeuroAgentHarness({
            store,
            profiles,
            model,
            capabilities: [{
                capability: llmlintAnalysisContext,
                open: () => ({load: async () => ({body, chunks: [{start: 0, end: body.length, text: body}], scanStats: {hitCount: 0, docScore: 0}, ruleIds: new Set<string>(), ruleLevels: new Map(), rulesText: "无"})}),
            }, revisionProvider(body)],
        });
        await harness.createSession({profileKey: "llmlint.review", initial: {revisionId: "revision-line-coverage", userId: 6}, hostContext: {revisionId: "revision-line-coverage", userId: 6}});

        const result = await (await harness.invoke({sessionId: "session-line-coverage", payload: {mode: "prompt", phase: "analysis", revisionId: "revision-line-coverage"}})).result();

        expect(result.status).toBe("completed");
        expect(model.requests).toHaveLength(5);
        expect(result.output).toMatchObject({report: {conclusion: "逐行完成"}});
    });
});

function unusedAnalysisProvider() {
    return {
        capability: llmlintAnalysisContext,
        open: () => ({load: async () => { throw new Error("optimize 不应加载 analysis context"); }}),
    };
}

function revisionProvider(body = "", llmHits: Array<{ruleId: string; quote: string; reason: string; span: {start: number; end: number} | null}> = []) {
    return {
        capability: llmlintRevisionTextSource,
        open: () => ({
            forRevision: async (revisionId: string) => ({
                current: async () => ({revisionId, ordinal: 0, body}),
                revision: async () => { throw new Error("测试没有历史 Revision"); },
                detections: async () => ({
                    status: {scan: "waiting" as const, llmReview: llmHits.length > 0 ? "completed" as const : "waiting" as const, detectors: "waiting" as const},
                    scan: null,
                    llmReview: llmHits.length > 0 ? {model: "test/model", promptVersion: "test", score: 1, confidence: 1, hits: llmHits, report: {score: 1, confidence: 1, conclusion: "命中", evidence: [], suggestions: []}, judgedAt: "now"} : null,
                    detectors: [],
                }),
            }),
        }),
    };
}

function profileCapabilities() {
    return [unusedAnalysisProvider(), revisionProvider()];
}

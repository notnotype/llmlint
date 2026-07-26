import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {AgentSessionSnapshot} from "../../shared/agent-harness";
import {ref} from "vue";
import {useAgentChat, type AgentSelection} from "../../app/composables/useAgentChat";

vi.mock("../../app/composables/useLlmlintI18n", () => ({
    useLlmlintI18n: () => ({t: (key: string) => key}),
}));
vi.mock("../../app/composables/useNotification", () => ({
    useNotification: () => ({success: vi.fn(), error: vi.fn(), info: vi.fn(), notify: vi.fn()}),
}));

const originalWarn = console.warn;

beforeEach(() => {
    console.warn = () => undefined;
});

afterEach(() => {
    console.warn = originalWarn;
    Reflect.deleteProperty(globalThis, "$fetch");
});

describe("useAgentChat invocation intent", () => {
    it("一键修到底始终发送全文请求，不携带残留选区", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (options?.method === "POST") return {invocationId: "invocation-full"};
            return emptySnapshot();
        });
        const chat = createChat();
        await settle();
        chat.prepareSelection(selection());

        await chat.startFull();

        const invoke = requests.find((request) => request.options?.method === "POST");
        expect(invoke?.options?.body).toMatchObject({phase: "optimize", objective: "polish_ai_risk"});
        expect(invoke?.options?.body).not.toHaveProperty("selection");
    });

    it("一键修到底先应用宿主 auto 修复，再把更新后的草稿交给 Agent", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        const draftState = {value: "正文！！", __v_isRef: true as const};
        let applied = 0;
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (options?.method === "POST") return {invocationId: "invocation-auto-fixed"};
            return emptySnapshot();
        });
        const chat = useAgentChat({
            panel: testRef({getActiveDiffId: () => null, getLlmDiffs: () => [], getRepairPlan: () => ({source: "正文！！", edits: []})}),
            editDraft: draftState as never,
            sessionId: testRef("session-1"),
            revisionId: testRef("revision-1"),
            editorActive: () => true,
            applyOneClickAutoFixes: () => {
                applied += 1;
                draftState.value = "正文！";
            },
        });
        await settle();

        await chat.startFull();

        const invoke = requests.find((request) => request.options?.method === "POST");
        expect(applied).toBe(1);
        expect(invoke?.options?.body).toMatchObject({body: "正文！"});
    });

    it("普通用户消息继续携带当前选区", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (options?.method === "POST") return {invocationId: "invocation-selection"};
            return emptySnapshot();
        });
        const chat = createChat();
        await settle();
        chat.prepareSelection(selection());

        await chat.send("只修改选区");

        const invoke = requests.find((request) => request.options?.method === "POST");
        expect(invoke?.options?.body).toMatchObject({selection: {from: 0, to: 2, text: "正文"}});
    });

    it("历史 Analysis 重试使用当前 head Session", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (options?.method === "POST") return {invocationId: "analysis-history"};
            return emptySnapshot();
        });
        const chat = createChat();
        await settle();

        await chat.startAnalysis("revision-history");

        const invoke = requests.find((request) => request.options?.method === "POST");
        expect(invoke).toMatchObject({
            url: "/api/agent/sessions/session-1/invoke",
            options: {body: {mode: "prompt", phase: "analysis", revisionId: "revision-history"}},
        });
    });

    it("Analysis cancel 不会取消不匹配的 active optimize", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (options?.method === "POST") return {status: "aborting"};
            return runningOptimizeSnapshot();
        });
        const chat = createChat();
        await settle();

        await chat.abortAnalysis("revision-history");

        expect(requests.some((request) => request.url.endsWith("/abort") && request.options?.method === "POST")).toBe(false);
    });

    it("Analysis cancel 只取消匹配 Revision 的 active Invocation", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (url.endsWith("/abort") && options?.method === "POST") return {status: "aborting"};
            return runningAnalysisSnapshot("revision-history");
        });
        const chat = createChat();
        await settle();

        await chat.abortAnalysis("revision-history");

        expect(requests.find((request) => request.url.endsWith("/abort"))).toMatchObject({
            url: "/api/agent/sessions/session-1/abort",
            options: {method: "POST", body: {invocationId: "analysis-active"}},
        });
    });

    it("历史恢复会重新读取 snapshot 并终止服务端当前运行", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        let restoring = false;
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (url.endsWith("/abort") && options?.method === "POST") return {status: "aborting"};
            return restoring ? runningOptimizeSnapshot() : emptySnapshot();
        });
        const chat = createChat();
        await settle();
        restoring = true;

        await chat.abortRestored();

        expect(requests.find((request) => request.url.endsWith("/abort"))).toMatchObject({
            url: "/api/agent/sessions/session-1/abort",
            options: {method: "POST", body: {invocationId: "optimize-active"}},
        });
    });

    it("切换到历史 Session 后立即恢复也会终止新 Session 的 active Invocation", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        const sessionId = ref<string | null>("session-1");
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (url.endsWith("/abort") && options?.method === "POST") return {status: "aborting"};
            if (url.includes("/session-2")) return {...runningOptimizeSnapshot(), sessionId: "session-2"};
            return emptySnapshot();
        });
        const chat = useAgentChat({
            panel: testRef({getActiveDiffId: () => null, getLlmDiffs: () => [], getRepairPlan: () => ({source: "正文", edits: []})}),
            editDraft: testRef("正文"),
            sessionId,
            revisionId: testRef<string | null>("revision-1"),
            editorActive: () => true,
            applyOneClickAutoFixes: () => undefined,
        });
        await settle();

        sessionId.value = "session-2";
        await chat.abortRestored();

        expect(requests.find((request) => request.url === "/api/agent/sessions/session-2/abort")).toMatchObject({
            options: {method: "POST", body: {invocationId: "optimize-active"}},
        });
    });

    it("跨篇 abandon 会清除上一 Session 的 aborting 状态并终止恢复 Session", async () => {
        const requests: Array<{url: string; options?: {method?: string; body?: Record<string, unknown>}}> = [];
        const sessionState = {value: "session-1" as string | null, __v_isRef: true as const};
        stubFetch(async (url: string, options?: {method?: string; body?: Record<string, unknown>}) => {
            requests.push({url, options});
            if (url.endsWith("/abort") && options?.method === "POST") return {status: "aborting"};
            return {...runningOptimizeSnapshot(), sessionId: sessionState.value ?? "session-1"};
        });
        const chat = useAgentChat({
            panel: testRef({getActiveDiffId: () => null, getLlmDiffs: () => [], getRepairPlan: () => ({source: "正文", edits: []})}),
            editDraft: testRef("正文"),
            sessionId: sessionState as never,
            revisionId: testRef<string | null>("revision-1"),
            editorActive: () => true,
            applyOneClickAutoFixes: () => undefined,
        });
        await settle();
        await chat.abort();

        chat.abandonAll();
        sessionState.value = "session-2";
        await chat.abortRestored();

        expect(requests.filter((request) => request.url.endsWith("/abort")).map((request) => request.url)).toEqual([
            "/api/agent/sessions/session-1/abort",
            "/api/agent/sessions/session-2/abort",
        ]);
    });
});

/** 创建只覆盖 invocation 请求合同的最小 Agent Chat 宿主。 */
function createChat() {
    const panel = {
        getActiveDiffId: () => null,
        getLlmDiffs: () => [],
        getRepairPlan: () => ({source: "正文", edits: []}),
    };
    return useAgentChat({
        panel: testRef(panel),
        editDraft: testRef("正文"),
        sessionId: testRef("session-1"),
        revisionId: testRef("revision-1"),
        editorActive: () => true,
        applyOneClickAutoFixes: () => undefined,
    });
}

function selection(): AgentSelection {
    return {from: 0, to: 2, text: "正文", contextBefore: "", contextAfter: ""};
}

function emptySnapshot(): AgentSessionSnapshot {
    return {
        sessionId: "session-1",
        revisionId: "revision-1",
        profileKey: "llmlint.review",
        status: "idle",
        activeInvocation: null,
        activeWorkspace: null,
        invocations: [],
        entries: [],
        report: null,
        hits: [],
        eventCursor: {eventEpoch: "epoch-1", after: 0},
    };
}

function runningOptimizeSnapshot(): AgentSessionSnapshot {
    const invocation: AgentSessionSnapshot["activeInvocation"] = {
        id: "optimize-active",
        mode: "prompt",
        phase: "optimize",
        status: "running",
        turns: 1,
        error: null,
        createdAt: "2026-07-20T00:00:00.000Z",
        finishedAt: null,
        input: {mode: "prompt", phase: "optimize", revisionId: "revision-1", message: "改写", body: "正文"},
        result: null,
    };
    return {...emptySnapshot(), status: "running", activeInvocation: invocation, invocations: [invocation]};
}

function runningAnalysisSnapshot(revisionId: string): AgentSessionSnapshot {
    const invocation: AgentSessionSnapshot["activeInvocation"] = {
        id: "analysis-active",
        mode: "prompt",
        phase: "analysis",
        status: "running",
        turns: 1,
        error: null,
        createdAt: "2026-07-20T00:00:00.000Z",
        finishedAt: null,
        input: {mode: "prompt", phase: "analysis", revisionId},
        result: null,
    };
    return {...emptySnapshot(), status: "running", activeInvocation: invocation, invocations: [invocation]};
}

async function settle(): Promise<void> {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Vue ref 的最小运行时合同，避免根测试包重复安装 Vue。 */
function testRef<T>(value: T) {
    return {value, __v_isRef: true} as never;
}

/** 安装可由 Bun/Vitest 共同消费的 Nuxt $fetch 测试替身。 */
function stubFetch(handler: FetchStub): void {
    Object.defineProperty(globalThis, "$fetch", {configurable: true, writable: true, value: vi.fn(handler)});
}

type FetchStub = (url: string, options?: {method?: string; body?: Record<string, unknown>}) => Promise<AgentSessionSnapshot | {invocationId: string} | {status: "aborting"}>;

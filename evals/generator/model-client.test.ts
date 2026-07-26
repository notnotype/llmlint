// model-client 可靠性守门(bun:test)。只测纯分类 classifyOutcome + 重试循环 callWithRetry,
// 不碰网络(callWithRetry 注入假 attempt + 无操作 sleepFn 免等待)。
import {test, expect} from "bun:test";
import {classifyOutcome, classifyTurnOutcome, callWithRetry} from "./model-client";

// 造假 AssistantMessage(最小形态,结构匹配 model-client 内部类型)。
type Msg = {content: Array<{type: string; text?: string}>; stopReason?: string; errorMessage?: string; usage?: {output?: number}};
const withText = (text: string): Msg => ({content: [{type: "text", text}], stopReason: "stop"});
const empty = (output = 0): Msg => ({content: [], stopReason: "stop", usage: {output}});
const errored = (errorMessage: string): Msg => ({content: [], stopReason: "error", errorMessage});
const noop = async (): Promise<void> => {};

test("classifyOutcome：有 text → ok", () => {
    const o = classifyOutcome({assistant: withText("正文…")});
    expect(o.kind).toBe("ok");
    expect(o.kind === "ok" && o.text).toBe("正文…");
});

test("classifyOutcome：空输出(stop 无 text) → retry empty-output，带 usage 诊断", () => {
    const o = classifyOutcome({assistant: empty(0)});
    expect(o.kind).toBe("retry");
    expect(o.kind !== "ok" && o.reason).toBe("empty-output");
    expect(o.kind !== "ok" && o.detail).toContain("output_tokens=0");
});

test("classifyOutcome：length 且无可见文本(推理烧光预算) → terminal，不白重试", () => {
    // doubao-seed-2-1-pro 实测：8000 token 全烧在 thinking 上、stopReason=length、可见正文≈0。
    const o = classifyOutcome({assistant: {content: [], stopReason: "length", usage: {output: 8000}}});
    expect(o.kind).toBe("terminal");
    expect(o.kind !== "ok" && o.reason).toContain("length-no-visible-text");
    expect(o.kind !== "ok" && o.detail).toContain("output_tokens=8000");
});

test("classifyOutcome：拒答/内容过滤 → terminal(重试无益)", () => {
    const o = classifyOutcome({assistant: errored("request blocked by content filter")});
    expect(o.kind).toBe("terminal");
    expect(o.kind !== "ok" && o.reason).toBe("refusal/filter");
});

test("classifyOutcome：未激活/404 → terminal auth", () => {
    const o = classifyOutcome({assistant: errored("Your account has not activated the model … 404")});
    expect(o.kind).toBe("terminal");
    expect(o.kind !== "ok" && o.reason).toBe("auth/client-error");
});

test("classifyOutcome：429 限流(抛出的 error) → retry transient", () => {
    const o = classifyOutcome({error: new Error("429 rate limit exceeded")});
    expect(o.kind).toBe("retry");
    expect(o.kind !== "ok" && o.reason).toBe("transient");
});

test("classifyOutcome：context 溢出 → terminal", () => {
    const o = classifyOutcome({assistant: errored("maximum context length is 128000 tokens")});
    expect(o.kind).toBe("terminal");
    expect(o.kind !== "ok" && o.reason).toBe("context-overflow");
});

test("classifyTurnOutcome：provider timeout/aborted 立即 terminal，不自动重试", () => {
    for (const message of ["Request was aborted", "request timeout after 360000ms"]) {
        const outcome = classifyTurnOutcome({error: new Error(message)});
        expect(outcome.kind).toBe("terminal");
        expect(outcome.kind !== "ok" && outcome.reason).toBe("provider-timeout/aborted");
    }
});

test("classifyTurnOutcome：429/5xx/连接瞬断仍可重试", () => {
    for (const message of ["429 rate limit", "HTTP 503", "ECONNRESET"]) {
        const outcome = classifyTurnOutcome({error: new Error(message)});
        expect(outcome.kind).toBe("retry");
    }
});

test("callWithRetry：空一次 → 成功，只重试一次(attempt 调 2 次)", async () => {
    const outs: Msg[] = [empty(0), withText("好的正文")];
    let calls = 0;
    const attempt = async (): Promise<Msg> => {
        calls += 1;
        return outs[calls - 1]!;
    };
    const text = await callWithRetry(attempt, "test", 3, noop);
    expect(text).toBe("好的正文");
    expect(calls).toBe(2);
});

test("callWithRetry：terminal 立即抛，不重试(attempt 调 1 次)", async () => {
    let calls = 0;
    const attempt = async (): Promise<Msg> => {
        calls += 1;
        return errored("has not activated the model");
    };
    await expect(callWithRetry(attempt, "test", 3, noop)).rejects.toThrow(/终态失败/u);
    expect(calls).toBe(1);
});

test("callWithRetry：一直空 → 耗尽 maxAttempts 后抛(attempt 调满 3 次)", async () => {
    let calls = 0;
    const attempt = async (): Promise<Msg> => {
        calls += 1;
        return empty(0);
    };
    await expect(callWithRetry(attempt, "test", 3, noop)).rejects.toThrow(/重试 3 次仍失败/u);
    expect(calls).toBe(3);
});

// M2 硬化的纯逻辑守门（bun:test）：限流并发/间隔、预算校准方向、CLI system+user 合并契约。
import {test, expect} from "bun:test";
import {ProviderGate} from "./rate-limit";
import {estimateRenderTokens, calibrate, type Calibration} from "./budget";
import {parseCodexJson} from "./cli-transport";
import {classifyToolOutcome} from "./model-client";
import {sanitizeClassification} from "../classifier/classify-agent";

test("ProviderGate：concurrency=1 强制串行（第二个任务在第一个结束后才开始）", async () => {
    const gate = new ProviderGate({concurrency: 1, minIntervalMs: 0}, {});
    const order: string[] = [];
    let firstReleased = false;
    const a = gate.run("p", async () => {
        order.push("a-start");
        await sleep(30);
        firstReleased = true;
        order.push("a-end");
    });
    const b = gate.run("p", async () => {
        // 若并发未受限，b 会在 a 结束前就 start。
        expect(firstReleased).toBe(true);
        order.push("b-start");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
});

test("ProviderGate：不同 provider 之间不互相阻塞（各自独立并发额度）", async () => {
    const gate = new ProviderGate({concurrency: 1, minIntervalMs: 0}, {});
    let bStarted = false;
    const a = gate.run("p1", async () => {
        await sleep(30);
    });
    const b = gate.run("p2", async () => {
        bStarted = true;
    });
    await b; // p2 不该等 p1
    expect(bStarted).toBe(true);
    await a;
});

test("ProviderGate：minIntervalMs 让相邻放行拉开间隔", async () => {
    const gate = new ProviderGate({concurrency: 2, minIntervalMs: 40}, {});
    const starts: number[] = [];
    const base = Date.now();
    await Promise.all([
        gate.run("p", async () => {
            starts.push(Date.now() - base);
        }),
        gate.run("p", async () => {
            starts.push(Date.now() - base);
        }),
    ]);
    // 两次放行间隔 ≥ ~40ms（宽松阈值防抖）。
    expect(Math.abs(starts[1]! - starts[0]!)).toBeGreaterThanOrEqual(30);
});

test("estimateRenderTokens：中文按 chars/系数折算 + system 常量", () => {
    const est = estimateRenderTokens(300, 3000, 1.5);
    expect(est.output).toBe(2000); // 3000/1.5
    expect(est.input).toBe(400); // 300/1.5 + 200
});

test("calibrate：实报 > 预估 → 系数调小（每 token 装的字变少）", () => {
    const prev: Calibration = {charsPerToken: 1.5, ratioSamples: 0, lastRatio: 1};
    // 预估 output 2000，实报 4000（低估一半）→ ratio=0.5 → 系数应下降。
    const next = calibrate(2000, 4000, prev);
    expect(next.charsPerToken).toBeLessThan(1.5);
    expect(next.lastRatio).toBe(0.5);
});

test("parseCodexJson：从 JSONL 抽 agent_message.text（跳过 banner/reasoning，取末条 + usage）", () => {
    const stdout = [
        '{"type":"thread.started"}',
        '{"type":"item.completed","item":{"type":"reasoning","text":"忽略推理"}}',
        'plain banner line (非 JSON，跳过)',
        '{"type":"item.completed","item":{"type":"agent_message","text":"这是正文答案"}}',
        '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":5}}',
    ].join("\n");
    const msg = parseCodexJson(stdout);
    expect(msg.stopReason).toBe("stop");
    expect(msg.content[0]?.text).toBe("这是正文答案");
    expect(msg.usage?.output).toBe(5);
});

test("parseCodexJson：无 agent_message → error（让 classifyOutcome 重试）", () => {
    const msg = parseCodexJson('{"type":"thread.started"}\n{"type":"turn.completed"}');
    expect(msg.stopReason).toBe("error");
});

test("classifyToolOutcome：调了目标工具 → ok 带参数", () => {
    const o = classifyToolOutcome({assistant: {content: [{type: "toolCall", name: "report_classification", arguments: {genre: "wuxia"}}], stopReason: "toolUse"}}, "report_classification");
    expect(o.kind).toBe("ok");
    expect(o.kind === "ok" && o.toolArguments.genre).toBe("wuxia");
});

test("classifyToolOutcome：散文回答没调工具 → retry no-tool-call", () => {
    const o = classifyToolOutcome({assistant: {content: [{type: "text", text: "这段是武侠"}], stopReason: "stop"}}, "report_classification");
    expect(o.kind).toBe("retry");
    expect(o.kind !== "ok" && o.reason).toBe("no-tool-call");
});

test("sanitizeClassification：unknown 留空、白名单外丢弃、合法值保留", () => {
    const c = sanitizeClassification({genre: "wuxia", textType: "unknown", pov: "花里胡哨的非法值"});
    expect(c.genre).toBe("wuxia");
    expect(c.textType).toBeUndefined();
    expect(c.pov).toBeUndefined();
});

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

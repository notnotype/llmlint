import {afterEach, describe, expect, it, vi} from "vitest";
import type {AgentEventSubscription} from "../web/server/agent/harness-port";
import {AgentSseLifecycle, type AgentSseStreamPort} from "../web/server/agent/sse-lifecycle";
import type {AgentSessionEvent} from "../web/shared/agent-harness";

afterEach(() => {
    vi.useRealTimers();
});

describe("Agent SSE lifecycle", () => {
    it("客户端断开后停止 heartbeat，并且只关闭一次 Harness subscription", async () => {
        vi.useFakeTimers();
        const stream = new FakeStream();
        const subscription = new FakeSubscription();
        const lifecycle = new AgentSseLifecycle(stream, subscription);

        await lifecycle.start();
        vi.advanceTimersByTime(15_000);
        await Promise.resolve();
        expect(stream.messages.map((message) => message.event)).toEqual(["connected", "heartbeat"]);

        await stream.disconnect();
        await lifecycle.done;
        const countAfterDisconnect = stream.messages.length;
        vi.advanceTimersByTime(45_000);
        await Promise.resolve();
        await Promise.all([lifecycle.close(), lifecycle.close()]);

        expect(stream.messages).toHaveLength(countAfterDisconnect);
        expect(subscription.closeCalls).toBe(1);
    });

    it("消费客户端断开时在途 push 的关闭拒绝", async () => {
        const stream = new BlockingStream();
        const event = runtimeEvent(1);
        const subscription = new FakeSubscription([event]);
        const errors: Error[] = [];
        const lifecycle = new AgentSseLifecycle(stream, subscription, {
            onError: (error) => errors.push(error),
        });

        await lifecycle.start();
        await stream.pushStarted;
        await stream.disconnect();
        stream.releasePush();
        await lifecycle.done;

        expect(errors).toEqual([]);
        expect(subscription.closeCalls).toBe(1);
    });
});

class FakeStream implements AgentSseStreamPort {
    readonly messages: Array<{event: string; data: string}> = [];
    protected closed = false;
    private readonly closedCallbacks: Array<() => void> = [];

    /** 记录成功写入；关闭后模拟 Web WritableStream 的拒绝。 */
    async push(message: {event: string; data: string}): Promise<void> {
        if (this.closed) throw new TypeError("Invalid state: WritableStream is closed");
        this.messages.push(message);
    }

    /** 注册底层 writer 关闭回调。 */
    onClosed(callback: () => void): void {
        this.closedCallbacks.push(callback);
    }

    /** 幂等关闭测试 stream。 */
    async close(): Promise<void> {
        await this.disconnect();
    }

    /** 模拟浏览器主动断开 SSE。 */
    async disconnect(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        for (const callback of this.closedCallbacks) callback();
        await Promise.resolve();
    }
}

class BlockingStream extends FakeStream {
    private markPushStarted!: () => void;
    private unblockPush!: () => void;
    readonly pushStarted = new Promise<void>((resolve) => { this.markPushStarted = resolve; });
    private readonly pushReleased = new Promise<void>((resolve) => { this.unblockPush = resolve; });

    /** agent_event 写入保持在途，直到测试显式释放。 */
    override async push(message: {event: string; data: string}): Promise<void> {
        if (message.event !== "agent_event") {
            await super.push(message);
            return;
        }
        this.markPushStarted();
        await this.pushReleased;
        await super.push(message);
    }

    /** 释放在途写入，使其观察到已经关闭的 stream。 */
    releasePush(): void {
        this.unblockPush();
    }
}

class FakeSubscription implements AgentEventSubscription {
    readonly connected = {
        type: "connected" as const,
        sessionId: "session-1",
        eventEpoch: "epoch-1",
        latestSeq: 0,
        snapshotRequired: false,
    };
    closeCalls = 0;
    private closed = false;
    private readonly events: AgentSessionEvent[];
    private pendingNext?: (result: IteratorResult<AgentSessionEvent>) => void;

    constructor(events: AgentSessionEvent[] = []) {
        this.events = [...events];
    }

    /** 返回测试事件，随后等待 close 结束迭代。 */
    [Symbol.asyncIterator](): AsyncIterator<AgentSessionEvent> {
        return {
            next: async () => {
                const event = this.events.shift();
                if (event) return {done: false, value: event};
                if (this.closed) return {done: true, value: undefined};
                return new Promise<IteratorResult<AgentSessionEvent>>((resolve) => {
                    this.pendingNext = resolve;
                });
            },
        };
    }

    /** 结束等待中的 iterator；重复调用不重复计数。 */
    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        this.closeCalls += 1;
        this.pendingNext?.({done: true, value: undefined});
        this.pendingNext = undefined;
    }
}

/** 构造单条最小 runtime event。 */
function runtimeEvent(seq: number): AgentSessionEvent {
    return {
        seq,
        eventEpoch: "epoch-1",
        sessionId: "session-1",
        invocationId: "invocation-1",
        kind: "runtime",
        event: {type: "turn_start", turn: 1},
    };
}

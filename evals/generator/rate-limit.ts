// per-provider 限流：并发信号量 + 相邻请求最小间隔。简单实现，不引库。
// 生成主循环目前是串行的，限流主要约束：detector 批量打分、CLI 通道、未来并行化。
import type {RateLimitRule} from "./eval-config";

type ProviderState = {
    /** 当前占用的并发额度 */
    active: number;
    /** 排队中的 waiter（FIFO） */
    queue: Array<() => void>;
    /** 上一次放行的时刻（ms），配合 minIntervalMs 做间隔 */
    lastStartAt: number;
};

export class ProviderGate {
    private readonly states = new Map<string, ProviderState>();

    constructor(
        private readonly defaultRule: RateLimitRule = {concurrency: 1, minIntervalMs: 0},
        private readonly perProvider: Record<string, RateLimitRule> = {},
    ) {}

    /** 在 providerId 的限流约束下执行 fn：并发满则排队，间隔不足则等待。 */
    async run<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
        const rule = this.perProvider[providerId] ?? this.defaultRule;
        const state = this.stateOf(providerId);
        await this.acquire(state, rule);
        try {
            return await fn();
        } finally {
            this.release(state);
        }
    }

    private stateOf(providerId: string): ProviderState {
        let state = this.states.get(providerId);
        if (!state) {
            state = {active: 0, queue: [], lastStartAt: 0};
            this.states.set(providerId, state);
        }
        return state;
    }

    private async acquire(state: ProviderState, rule: RateLimitRule): Promise<void> {
        // 并发额度：满了排 FIFO 队列，release 时唤醒队首。
        if (state.active >= Math.max(1, rule.concurrency)) {
            await new Promise<void>((resolve) => state.queue.push(resolve));
        }
        state.active += 1;
        // 最小间隔：距上次放行不足 minIntervalMs 则补足等待。
        const wait = state.lastStartAt + rule.minIntervalMs - Date.now();
        if (wait > 0) {
            await sleep(wait);
        }
        state.lastStartAt = Date.now();
    }

    private release(state: ProviderState): void {
        state.active -= 1;
        state.queue.shift()?.();
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

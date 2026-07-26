import type {AgentEventSubscription} from "./harness-port";

const HEARTBEAT_MILLISECONDS = 15_000;

/** H3 EventStream 在 Agent SSE 生命周期中需要的最小能力。 */
export interface AgentSseStreamPort {
    push(message: {event: string; data: string}): Promise<void>;
    onClosed(callback: () => void): void;
    close(): Promise<void>;
}

/** Agent SSE 生命周期配置。 */
export interface AgentSseLifecycleOptions {
    readonly heartbeatMilliseconds?: number;
    readonly onError?: (error: Error) => void;
}

/**
 * 统一拥有 heartbeat、Harness subscription 和后台转发任务。
 * 客户端断开、writer 拒绝、subscription 结束都收敛到同一个幂等 close。
 */
export class AgentSseLifecycle {
    private readonly stream: AgentSseStreamPort;
    private readonly subscription: AgentEventSubscription;
    private readonly heartbeatMilliseconds: number;
    private readonly onError: (error: Error) => void;
    private heartbeat?: ReturnType<typeof setInterval>;
    private forwardTask: Promise<void> = Promise.resolve();
    private closeTask?: Promise<void>;
    private started = false;
    private closed = false;

    constructor(stream: AgentSseStreamPort, subscription: AgentEventSubscription, options: AgentSseLifecycleOptions = {}) {
        this.stream = stream;
        this.subscription = subscription;
        this.heartbeatMilliseconds = options.heartbeatMilliseconds && options.heartbeatMilliseconds > 0
            ? options.heartbeatMilliseconds
            : HEARTBEAT_MILLISECONDS;
        this.onError = options.onError ?? ((error) => console.error("[agent-sse] 事件转发失败", error));
        this.stream.onClosed(() => {
            void this.close();
        });
    }

    /** 后台事件转发任务；close 后等待它退出可证明请求资源已经释放。 */
    get done(): Promise<void> {
        return this.forwardTask;
    }

    /** 发送 connected，启动 heartbeat 和 Core 事件转发。重复调用保持幂等。 */
    async start(): Promise<void> {
        if (this.started || this.closed) return;
        this.started = true;
        const connected = await this.push("connected", JSON.stringify(this.subscription.connected));
        if (!connected) return;
        this.heartbeat = setInterval(() => {
            void this.push("heartbeat", "{}");
        }, this.heartbeatMilliseconds);
        this.forwardTask = this.forward();
    }

    /** 幂等停止 heartbeat、关闭 Core subscription 和 SSE writer。此方法不会拒绝。 */
    close(): Promise<void> {
        if (this.closeTask) return this.closeTask;
        this.closed = true;
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = undefined;
        }
        this.closeTask = this.releaseResources();
        return this.closeTask;
    }

    /** 顺序消费 Core 事件，保持 Core cursor 的唯一顺序。 */
    private async forward(): Promise<void> {
        try {
            for await (const message of this.subscription) {
                if (!await this.push("agent_event", JSON.stringify(message))) break;
            }
        } catch (error) {
            if (!this.closed) this.report(error);
        } finally {
            await this.close();
        }
    }

    /** writer 关闭属于正常断连：消费 push rejection，并触发统一 cleanup。 */
    private async push(event: string, data: string): Promise<boolean> {
        if (this.closed) return false;
        try {
            await this.stream.push({event, data});
            return !this.closed;
        } catch {
            await this.close();
            return false;
        }
    }

    /** 关闭两个资源；即使底层 close 报错，也不制造后台未处理拒绝。 */
    private async releaseResources(): Promise<void> {
        try {
            await this.subscription.close();
        } catch (error) {
            this.report(error);
        }
        try {
            await this.stream.close();
        } catch (error) {
            this.report(error);
        }
    }

    /** 将外部异常规范化后交给宿主日志出口，日志出口自身不能破坏 cleanup。 */
    private report(error: unknown): void {
        const normalized = error instanceof Error ? error : new Error(String(error));
        try {
            this.onError(normalized);
        } catch {
            // 日志出口不是资源清理的前置条件。
        }
    }
}

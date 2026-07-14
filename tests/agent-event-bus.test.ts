import {describe, expect, it} from "vitest";
import {AgentEventBus} from "../web/server/agent/event-bus";

describe("Agent SSE event hub", () => {
    it("递增 seq、按 cursor replay，并在 epoch 不匹配时要求 snapshot", () => {
        const hub = new AgentEventBus();
        const first = hub.publish({kind: "session", sessionId: "s1", event: {type: "status", status: "running"}});
        const second = hub.publish({kind: "runtime", sessionId: "s1", invocationId: "i1", event: {type: "turn_start", turn: 1}});
        expect([first.seq, second.seq]).toEqual([1, 2]);

        const live: number[] = [];
        const subscription = hub.subscribe("s1", {eventEpoch: first.eventEpoch, after: 1}, (event) => live.push(event.seq));
        expect(subscription.connected.snapshotRequired).toBe(false);
        expect(subscription.replay.map((event) => event.seq)).toEqual([2]);
        hub.publish({kind: "runtime", sessionId: "s1", invocationId: "i1", event: {type: "turn_end", turn: 1}});
        expect(live).toEqual([3]);
        subscription.unsubscribe();

        expect(hub.subscribe("s1", {eventEpoch: "old", after: 0}, () => {}).connected.snapshotRequired).toBe(true);
    });
});

import {randomUUID} from "node:crypto";
import type {AgentRuntimeEvent, AgentSessionConnected, AgentSessionControlEvent, AgentSessionEvent} from "#shared/agent-harness";

type Listener = (event: AgentSessionEvent) => void;
type EventInput =
    | {kind: "runtime"; sessionId: string; invocationId?: string; event: AgentRuntimeEvent}
    | {kind: "session"; sessionId: string; invocationId?: string; event: AgentSessionControlEvent};

type SessionStream = {eventEpoch: string; seq: number; buffer: AgentSessionEvent[]; listeners: Set<Listener>};
const MAX_REPLAY_EVENTS = 500;

/** NeuroBook 风格的进程内 event hub：seq/epoch/replay；Prisma snapshot 仍是恢复真相。 */
export class AgentEventBus {
    private readonly sessions = new Map<string, SessionStream>();

    cursor(sessionId: string): {eventEpoch: string; after: number} {
        const stream = this.stream(sessionId);
        return {eventEpoch: stream.eventEpoch, after: stream.seq};
    }

    publish(input: EventInput): AgentSessionEvent {
        const stream = this.stream(input.sessionId);
        const event = {...input, seq: ++stream.seq, eventEpoch: stream.eventEpoch} as AgentSessionEvent;
        stream.buffer.push(event);
        if (stream.buffer.length > MAX_REPLAY_EVENTS) stream.buffer.splice(0, stream.buffer.length - MAX_REPLAY_EVENTS);
        for (const listener of stream.listeners) listener(event);
        return event;
    }

    subscribe(sessionId: string, cursor: {eventEpoch?: string; after: number}, listener: Listener): {connected: AgentSessionConnected; replay: AgentSessionEvent[]; unsubscribe: () => void} {
        const stream = this.stream(sessionId);
        const oldestSeq = stream.buffer[0]?.seq ?? stream.seq + 1;
        const epochMatches = cursor.eventEpoch === undefined || cursor.eventEpoch === stream.eventEpoch;
        const replayAvailable = epochMatches && cursor.after >= oldestSeq - 1 && cursor.after <= stream.seq;
        const replay = replayAvailable ? stream.buffer.filter((event) => event.seq > cursor.after) : [];
        stream.listeners.add(listener);
        return {
            connected: {type: "connected", sessionId, eventEpoch: stream.eventEpoch, latestSeq: stream.seq, snapshotRequired: !replayAvailable},
            replay,
            unsubscribe: () => stream.listeners.delete(listener),
        };
    }

    private stream(sessionId: string): SessionStream {
        const existing = this.sessions.get(sessionId);
        if (existing) return existing;
        const created: SessionStream = {eventEpoch: randomUUID(), seq: 0, buffer: [], listeners: new Set()};
        this.sessions.set(sessionId, created);
        return created;
    }
}

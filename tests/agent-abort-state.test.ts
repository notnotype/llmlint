import {describe, expect, it} from "vitest";
import {abortNeedsRecovery} from "../web/app/utils/agent-abort-state";

describe("Agent abort state", () => {
    it("terminal 已先完成时要求立即恢复 snapshot", () => {
        expect(abortNeedsRecovery({status: "idle"})).toBe(true);
        expect(abortNeedsRecovery({status: "aborting"})).toBe(false);
    });
});

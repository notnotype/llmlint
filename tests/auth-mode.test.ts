import {describe, expect, it} from "vitest";
import {resolveAuthEnabled} from "../web/server/utils/auth-mode";

describe("resolveAuthEnabled", () => {
    it("开发配置 false/0/off 会关闭登录", () => {
        expect(resolveAuthEnabled(false)).toBe(false);
        expect(resolveAuthEnabled("false")).toBe(false);
        expect(resolveAuthEnabled("0")).toBe(false);
        expect(resolveAuthEnabled("off")).toBe(false);
    });

    it("生产配置 true/1/on 会启用登录", () => {
        expect(resolveAuthEnabled(true)).toBe(true);
        expect(resolveAuthEnabled("true")).toBe(true);
        expect(resolveAuthEnabled("1")).toBe(true);
        expect(resolveAuthEnabled("on")).toBe(true);
    });
});

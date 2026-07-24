import {existsSync} from "node:fs";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {runCli} from "../skill/src/cli";
import {loadUserSettings, saveUserSettings, userStateDir} from "../skill/src/user-state";

describe("user state", () => {
    const originalHome = process.env.LLMLINT_HOME;
    const tempRoots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
        if (originalHome === undefined) {
            delete process.env.LLMLINT_HOME;
        } else {
            process.env.LLMLINT_HOME = originalHome;
        }
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("首读返回默认值且不主动创建 settings.json", async () => {
        const home = await createHome();
        const settings = loadUserSettings();

        expect(userStateDir()).toBe(home);
        expect(settings).toMatchObject({
            version: 1,
            initialized: false,
            sharing: {tier: "fragments", mode: "ask", anonymous: false},
            detector: {
                proxy: null,
                space: "yuchuantian-aigc-text-detector.hf.space",
                chunkChars: 450,
                minIntervalMs: null,
            },
        });
        expect(existsSync(join(home, "settings.json"))).toBe(false);
    });

    it("保存往返使用四空格 JSON 和尾换行", async () => {
        const home = await createHome();
        saveUserSettings({
            ...loadUserSettings(),
            initialized: true,
            sharing: {tier: "stats", mode: "auto", anonymous: true},
        });

        const source = await readFile(join(home, "settings.json"), "utf-8");
        expect(source).toContain("    \"initialized\": true");
        expect(source.endsWith("\n")).toBe(true);
        expect(loadUserSettings().sharing).toEqual({tier: "stats", mode: "auto", anonymous: true});
    });

    it("缺失字段补默认，顶层和嵌套未知字段报错并带路径", async () => {
        const home = await createHome();
        await writeFile(join(home, "settings.json"), JSON.stringify({version: 1, sharing: {tier: "off"}}), "utf-8");
        expect(loadUserSettings().sharing).toEqual({tier: "off", mode: "ask", anonymous: false});

        await writeFile(join(home, "settings.json"), JSON.stringify({version: 1, typo: true}), "utf-8");
        expect(() => loadUserSettings()).toThrow(new RegExp(escapeRegExp(join(home, "settings.json"))));

        await writeFile(join(home, "settings.json"), JSON.stringify({version: 1, sharing: {tier: "off", items: []}}), "utf-8");
        expect(() => loadUserSettings()).toThrow(/sharing\.items/);
    });

    it("损坏 JSON 报错包含 settings.json 路径", async () => {
        const home = await createHome();
        await writeFile(join(home, "settings.json"), "{", "utf-8");

        expect(() => loadUserSettings()).toThrow(new RegExp(escapeRegExp(join(home, "settings.json"))));
    });

    it("CLI config set/get 往返，重复设置幂等", async () => {
        const home = await createHome();
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "config", "set", "sharing.tier", "stats"]);
        await runCli(["bun", "llmlint", "config", "set", "sharing.tier", "stats"]);
        await runCli(["bun", "llmlint", "config", "get", "sharing.tier"]);
        await runCli(["bun", "llmlint", "config", "get"]);

        expect(log.mock.calls[0]?.[0]).toBe("sharing.tier = \"stats\"");
        expect(log.mock.calls[1]?.[0]).toBe("sharing.tier = \"stats\"");
        expect(log.mock.calls[2]?.[0]).toBe("sharing.tier = \"stats\"");
        const all = JSON.parse(String(log.mock.calls[3]?.[0])) as {sharing: {tier: string}};
        expect(all.sharing.tier).toBe("stats");
        expect(existsSync(join(home, "settings.json"))).toBe(true);
    });

    it("CLI config 拒绝未知 key、非法枚举和非法整数，且失败不写文件", async () => {
        const home = await createHome();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "config", "set", "sharing.items", "stats"]);
        expect(process.exitCode).toBe(1);
        expect(error.mock.calls.at(-1)?.[0]).toContain("合法键");
        expect(existsSync(join(home, "settings.json"))).toBe(false);

        process.exitCode = undefined;
        await runCli(["bun", "llmlint", "config", "set", "sharing.tier", "private"]);
        expect(process.exitCode).toBe(1);
        expect(existsSync(join(home, "settings.json"))).toBe(false);

        process.exitCode = undefined;
        await runCli(["bun", "llmlint", "config", "set", "detector.chunkChars", "0"]);
        expect(process.exitCode).toBe(1);
        expect(existsSync(join(home, "settings.json"))).toBe(false);
    });

    it("CLI status --format json 输出初始化状态、项目配置路径与缓存目录", async () => {
        const home = await createHome();
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "status", "--format", "json"]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {
            kind: string;
            initialized: boolean;
            login: string;
            configPath: string | null;
            detector: {space: string; proxyConfigured: boolean; cacheDir: string};
        };
        expect(report.kind).toBe("status");
        expect(report.initialized).toBe(false);
        expect(report.login).toBe("none");
        expect(report.configPath === null || report.configPath.endsWith("llmlint.config.ts")).toBe(true);
        expect(report.detector.space).toBe("yuchuantian-aigc-text-detector.hf.space");
        expect(report.detector.proxyConfigured).toBe(false);
        expect(report.detector.cacheDir).toBe(join(home, "cache"));
    });

    async function createHome(): Promise<string> {
        const home = await mkdtemp(join(tmpdir(), "llmlint-home-"));
        tempRoots.push(home);
        process.env.LLMLINT_HOME = home;
        return home;
    }
});

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

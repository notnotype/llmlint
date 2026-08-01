import {mkdir, mkdtemp, readdir, rm, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {detectCacheKey, pruneDetectCache, readDetectCache, writeDetectCache} from "../skill/src/detect/cache";
import {chunkBySentence, visibleLen} from "../skill/src/detect/chunk";
import {aggregate, defaultDetectorOptions, toPAi, type DetectPayload} from "../skill/src/detect/transport";

describe("detect", () => {
    const originalHome = process.env.LLMLINT_HOME;
    const tempRoots: string[] = [];

    afterEach(async () => {
        if (originalHome === undefined) {
            delete process.env.LLMLINT_HOME;
        } else {
            process.env.LLMLINT_HOME = originalHome;
        }
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("chunkBySentence 按句界切分并合并短尾", () => {
        const first = "甲".repeat(430) + "。";
        const second = "乙".repeat(30) + "。";
        const third = "丙".repeat(120) + "。";
        const chunks = chunkBySentence(first + second + third, 450, 150);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.start).toBe(0);
        expect(chunks[0]!.end).toBe((first + second + third).length);
        expect(chunks[0]!.text.endsWith("。")).toBe(true);
    });

    it("chunkBySentence 处理空文本与无句读长串", () => {
        expect(chunkBySentence("")).toEqual([]);
        expect(chunkBySentence("   \n")).toEqual([]);

        const long = "没有句读".repeat(200);
        const chunks = chunkBySentence(long, 450, 150);
        expect(chunks).toEqual([{start: 0, end: long.length, text: long}]);
    });

    it("visibleLen 去空白后按码点计数", () => {
        expect(visibleLen("你 好\nabc")).toBe(5);
    });

    it("toPAi 归一标签概率并夹紧异常概率", () => {
        expect(toPAi("AI生成", 0.92)).toBe(0.92);
        expect(toPAi("人类", 0.8)).toBeCloseTo(0.2);
        expect(toPAi("human", 1.2)).toBe(0);
        expect(toPAi("AI", -1)).toBe(0);
    });

    it("aggregate 使用长度加权 mean 与 max", () => {
        const chunks = [
            {start: 0, end: 10, text: "甲".repeat(10)},
            {start: 10, end: 40, text: "乙".repeat(30)},
        ];
        const result = aggregate([0.1, 0.9], chunks);

        expect(result.docPAi).toBeCloseTo((0.1 * 10 + 0.9 * 30) / 40);
        expect(result.maxPAi).toBe(0.9);
        expect(aggregate([], [])).toEqual({docPAi: 0, maxPAi: 0});
    });

    it("cache 写读往返，口径变化不命中", async () => {
        await createHome();
        const options = defaultDetectorOptions();
        const content = "这是一段测试文本。";
        const key = detectCacheKey(content, options);
        const payload: DetectPayload = {
            detector: {
                version: options.version,
                endpoint: options.endpoint,
                space: options.space,
                chunkChars: options.chunkChars,
            },
            docPAi: 0.5,
            maxPAi: 0.8,
            chunks: [{span: [0, content.length], pAi: 0.5, line: 1}],
        };

        writeDetectCache(key, payload);
        expect(readDetectCache(key)).toEqual(payload);

        const otherKey = detectCacheKey(content, {...options, space: "other-space.hf.space"});
        expect(readDetectCache(otherKey)).toBeNull();
    });

    it("cache 损坏或形状非法按未命中处理", async () => {
        const home = await createHome();
        const options = defaultDetectorOptions();
        const key = detectCacheKey("x", options);
        await mkdir(join(home, "cache"), {recursive: true});
        await writeFile(join(home, "cache", `${key}.json`), "{", "utf-8");
        expect(readDetectCache(key)).toBeNull();

        await writeFile(join(home, "cache", `${key}.json`), JSON.stringify({generatedAt: "now", payload: {kind: "bad"}}), "utf-8");
        expect(readDetectCache(key)).toBeNull();
    });

    it("cache 按保留期、条目数和总字节回收", async () => {
        const home = await createHome();
        const cache = join(home, "cache");
        await mkdir(cache, {recursive: true});
        const expired = join(cache, `${"a".repeat(64)}.json`);
        const older = join(cache, `${"b".repeat(64)}.json`);
        const newest = join(cache, `${"c".repeat(64)}.json`);
        const ignored = join(cache, "owner.json");
        await Promise.all([
            writeFile(expired, "x".repeat(80), "utf-8"),
            writeFile(older, "y".repeat(80), "utf-8"),
            writeFile(newest, "z".repeat(80), "utf-8"),
            writeFile(ignored, "owner", "utf-8"),
        ]);
        await utimes(expired, new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-01T00:00:00.000Z"));
        await utimes(older, new Date("2026-06-27T10:00:00.000Z"), new Date("2026-06-27T10:00:00.000Z"));
        await utimes(newest, new Date("2026-06-27T11:00:00.000Z"), new Date("2026-06-27T11:00:00.000Z"));

        pruneDetectCache({
            maxAgeMs: 30 * 24 * 60 * 60 * 1000,
            maxEntries: 2,
            maxBytes: 100,
            nowMs: new Date("2026-06-28T12:00:00.000Z").getTime(),
        });

        expect((await readdir(cache)).sort()).toEqual([`${"c".repeat(64)}.json`, "owner.json"]);
    });

    async function createHome(): Promise<string> {
        const home = await mkdtemp(join(tmpdir(), "llmlint-detect-"));
        tempRoots.push(home);
        process.env.LLMLINT_HOME = home;
        return home;
    }
});

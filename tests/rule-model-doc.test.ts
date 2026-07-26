import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {HANDLER_REGISTRY} from "../skill/src/handler-rules";

// skill/references/rule-model.md 是规则数据模型的活契约。它最容易漂移的地方是「代码新增了
// 一种 detector 或一个 handler，文档没跟」——task 目录里的 rule-model-v3-design.md 就是这么
// 过时的。这里把「文档覆盖全部 detector 与 handler」变成测试，不靠下一个人记得更新。
//
// 刻意只校验「名字是否出现」这一层：更强的校验（字段逐个比对）会让文档变成类型定义的
// 复制品，反而阻碍它讲清取舍。

const DOC_PATH = "skill/references/rule-model.md";

/** 从 types.ts 抽出 detector 联合的成员名，避免在测试里手写一份清单而各自漂移。 */
function detectorTypes(): string[] {
    const types = readFileSync("skill/src/types.ts", "utf-8");
    const names = new Set<string>();
    for (const match of types.matchAll(/type\s+(\w+Detector)\s*=\s*\{\s*\n\s*type:\s*"(\w+)"/g)) {
        names.add(match[2]!);
    }
    return [...names];
}

describe("规则模型活契约文档", () => {
    it("覆盖全部 detector 类型", () => {
        const doc = readFileSync(DOC_PATH, "utf-8");
        const found = detectorTypes();
        expect(found.length, "未能从 types.ts 解析出 detector 类型，正则可能已失效").toBeGreaterThanOrEqual(3);

        const missing = found.filter((name) => !doc.includes(`"${name}"`));
        expect(missing, `${DOC_PATH} 未提及这些 detector 类型：${missing.join(", ")}`).toEqual([]);
    });

    it("handler 名单与注册表双向一致", () => {
        const doc = readFileSync(DOC_PATH, "utf-8");
        const registered = Object.keys(HANDLER_REGISTRY).sort();

        const missing = registered.filter((name) => !doc.includes(name));
        expect(missing, `${DOC_PATH} 未提及这些已注册 handler：${missing.join(", ")}`).toEqual([]);

        // 反向也要查：文档表格里编出一个不存在的 handler 同样是错的（写这份文档时就编了一个
        // `reverse-not-is`，那其实是规则 id）。只看 handler 那张表，别把基座字段表也算进来。
        const sectionStart = doc.indexOf("当前已注册的 handler：");
        expect(sectionStart, "文档缺少 handler 名单小节").toBeGreaterThan(-1);
        const section = doc.slice(sectionStart, doc.indexOf("\n\n", doc.indexOf("|", sectionStart)) + 1);
        const listed = [...section.matchAll(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|/gmu)].map((match) => match[1]!).sort();
        expect(listed.length, "未能从文档解析出 handler 表格，表格格式可能已变").toBeGreaterThanOrEqual(registered.length);

        const phantom = listed.filter((name) => !(name in HANDLER_REGISTRY));
        expect(phantom, `${DOC_PATH} 列出了未注册的 handler：${phantom.join(", ")}`).toEqual([]);
    });
});

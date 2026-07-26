import {describe, expect, it} from "vitest";
import {loadRules} from "../skill/src/rules";
import type {ActiveRuleRecord, NormalizedLlmlintConfig} from "../skill/src/types";

// 规则 title 的结构性守卫。
//
// 背景：`title` 是紧凑 check JSON（CompactRuleEntry）里唯一的人类可读标签——Agent 拿不到
// detector.targets 和 examples，只能靠 title + note + action 向读者说明发现了什么。整理前
// 266 条 active 规则里有 143 条与别的规则共用 title（19 条都叫「R18词汇」、14 条「人体词汇」），
// 还有 6 条把正则作者笔记（「必带的/地防误伤」）当标题。那种报告读者看不懂。
//
// 这三条不变量把该类退化变成不可能，而不是靠下一个人记得手动检查。

function defaultConfig(): NormalizedLlmlintConfig {
    return {
        rulesets: ["builtin/default"],
        trustedRulesets: [],
        rulesetOverrides: {},
        namespaces: {},
        rules: {},
        ignoreTerms: [],
        output: "stylish",
    };
}

/** title 里出现即视为泄漏的正则作者术语：这些词描述规则怎么写，不描述读者看到了什么问题。 */
const AUTHORING_JARGON = /防误伤|收窄|canonical|overlap|dataset|半截|\[可选\]|\[选开\]/i;

/** title 上限（码点）。紧凑 JSON 的体积收益要保住，也迫使 title 是标题而不是句子。 */
const MAX_TITLE_CHARS = 20;

async function activeRules(): Promise<ActiveRuleRecord[]> {
    const loaded = await loadRules(defaultConfig());
    return [...loaded.regexRules, ...loaded.densityRules, ...loaded.handlerRules, ...loaded.llmRules];
}

describe("规则 title 结构性守卫", () => {
    it("title 全局唯一：同名标题让报告无法说明发现了什么", async () => {
        const rules = await activeRules();
        const byTitle = new Map<string, string[]>();
        for (const rule of rules) {
            byTitle.set(rule.title, [...(byTitle.get(rule.title) ?? []), rule.id]);
        }
        const duplicates = [...byTitle.entries()]
            .filter(([, ids]) => ids.length > 1)
            .sort((left, right) => right[1].length - left[1].length)
            .map(([title, ids]) => `「${title}」×${ids.length} → ${ids.join(", ")}`);

        expect(duplicates, `以下 title 被多条规则共用：\n${duplicates.join("\n")}`).toEqual([]);
    });

    it("title 不含正则作者术语：作者笔记不能漏进用户可见字段", async () => {
        const rules = await activeRules();
        const leaked = rules
            .filter((rule) => AUTHORING_JARGON.test(rule.title))
            .map((rule) => `${rule.id}「${rule.title}」`);

        expect(leaked, `以下 title 含正则作者术语：\n${leaked.join("\n")}`).toEqual([]);
    });

    it(`title 不超过 ${MAX_TITLE_CHARS} 码点：标题不是句子，也别吃掉紧凑 JSON 的体积收益`, async () => {
        const rules = await activeRules();
        const overlong = rules
            .filter((rule) => [...rule.title].length > MAX_TITLE_CHARS)
            .map((rule) => `${rule.id}「${rule.title}」(${[...rule.title].length} 字)`);

        expect(overlong, `以下 title 过长：\n${overlong.join("\n")}`).toEqual([]);
    });
});

import {ruleActionSummary} from "./reporter";
import {ruleDetectorKind} from "./rule-registry";
import type {ActiveRuleRecord, LoadedRules, RuleLevel} from "./types";

/**
 * 写作期规则摘要（`llmlint guide`）。
 *
 * 与 `check` 的关系是「事前 / 事后」：`check` 在成稿上确定性定位候选，`guide` 把同一批规则
 * 投影成动笔之前的约束，供人阅读或注入系统提示词。
 *
 * 两条设计约束：
 *
 * 1. **同一条规则，两个投影，不加字段。** 写作期取 `title` + `action`（`action.message`
 *    本来就是祈使句写法）+ `examples[].bad`；审查期取 `detector.prompt` 与全部 examples。
 *    语义规则的 `detector.prompt` 是审稿员的判定流程（「判断文本是否…」），口气不对，
 *    不进写作期摘要。
 * 2. **不是全部规则都值得占提示词预算。** 能被 CLI 确定性定位、且能直接给出替换词的规则，
 *    事后 `check` 就够了；提示词的边际价值集中在「工具查不出来的」和「有配对语料证据的」。
 *    档位就是这个判据的实现。
 */

/**
 * 摘要档位。四档严格嵌套：core ⊂ standard ⊂ wide ⊂ full。
 *
 * - `core`：语义规则（CLI 永远抓不到，唯一执行路径就是模型读过）+ profile 里判别力 strong 的。
 * - `standard`：再加全部「建议类」规则——CLI 能定位症状，但改法要重写整句，事前不写远比事后重写便宜。
 * - `wide`：再加 profile 里判别力 weak 的。
 * - `full`：再加词表类规则（逐词替换与定点删除）。这类 CLI 抓得准也能提替换词，边际价值最低，所以排在最后。
 */
export type GuideTier = "core" | "standard" | "wide" | "full";

export const GUIDE_TIERS: GuideTier[] = ["core", "standard", "wide", "full"];

/**
 * 判别力档位：来自某个语料上的 eval 报告。
 *
 * 刻意**不**内建进 skill 包，也不写进规则记录——verdict 只在特定 task profile 内有效
 * （CONTEXT.md §3 / I12），把某个语料的结论烧进全局规则超集会让它看起来像规则的固有属性。
 * 没有 profile 时 core / wide 只按规则模型取，不假装有证据。
 */
export type RuleVerdicts = Map<string, "strong" | "weak">;

/** eval 报告里本模块唯一关心的形状；其余字段一概不读，避免和报告 schema 耦合。 */
type ProfileReport = {
    rules?: Array<{id?: unknown; verdict?: unknown}>;
};

/**
 * 从 eval 报告 JSON 文本解析规则判别力。
 *
 * @param text report.json 的内容。
 * @returns id → verdict 映射；只收 strong / weak，其余裁决桶（noise / anti / insufficient）
 *   对写作期没有意义，直接丢弃。解析失败时抛错，由 CLI 转成可读错误。
 */
export function parseRuleVerdicts(text: string): RuleVerdicts {
    const report = JSON.parse(text) as ProfileReport;
    if (!Array.isArray(report.rules)) {
        throw new Error("profile 报告缺少 rules 数组。");
    }
    const verdicts: RuleVerdicts = new Map();
    for (const entry of report.rules) {
        if (typeof entry.id !== "string") {
            continue;
        }
        if (entry.verdict === "strong" || entry.verdict === "weak") {
            verdicts.set(entry.id, entry.verdict);
        }
    }
    return verdicts;
}

/**
 * 按档位挑出进入摘要的规则。
 *
 * @param verdicts 判别力映射；空 Map 表示没有 profile，此时 core 只剩语义规则、wide 等同 standard。
 */
export function selectGuideRules(rules: ActiveRuleRecord[], tier: GuideTier, verdicts: RuleVerdicts): ActiveRuleRecord[] {
    return rules.filter((rule) => {
        // 语义规则：静态判据不存在，只能靠读，任何档位都在。
        if (ruleDetectorKind(rule) === "semantic") {
            return true;
        }
        const verdict = verdicts.get(rule.id);
        if (verdict === "strong") {
            return true;
        }
        if (tier === "core") {
            return false;
        }
        // 建议类：action 没有替换词，说明改法要重写，属于「预防远便宜于修复」那一类。
        if (rule.action.type === "suggest") {
            return true;
        }
        if (tier === "standard") {
            return false;
        }
        if (verdict === "weak") {
            return true;
        }
        return tier === "full";
    });
}

const LEVEL_ORDER: Record<RuleLevel, number> = {high: 0, medium: 1, low: 2};

/**
 * 渲染写作期摘要为 markdown。
 *
 * 输出是给人读也给模型读的散文，刻意不提供 JSON 形态——它的用途就是被贴进提示词。
 *
 * @param tier 当前档位，写进抬头供人判断摘要完整度。
 * @param total 当前配置下的 active 规则总数，用于抬头的「x / y 条」。
 */
export function renderGuide(rules: ActiveRuleRecord[], tier: GuideTier, total: number, rulesets: string[]): string {
    const semantic = rules.filter((rule) => ruleDetectorKind(rule) === "semantic");
    const principles = rules.filter((rule) => ruleDetectorKind(rule) !== "semantic" && rule.action.type === "suggest");
    const swaps = rules.filter((rule) => rule.action.type === "replace" && rule.action.replacements.filter(Boolean).length > 0);
    const removals = rules.filter((rule) => rule.action.type === "replace" && rule.action.replacements.filter(Boolean).length === 0);

    const lines: string[] = [
        "# 中文正文写作约束要点",
        "",
        "下面每一条都是成稿审查时会被当作问题的写法。写的时候直接避开，比写完再改省力。",
        "",
        "这不是禁令清单：如果某条写法在当前语境里承担剧情、人物声音、题材或载体功能，照写，",
        "不要为了绕开它牺牲语义或可读性。清单的作用是让你在无功能的默认写法上换一个选择。",
        "",
    ];

    if (semantic.length > 0) {
        lines.push("## 优先注意：静态工具查不出来的");
        lines.push("");
        lines.push("这几条没有可稳定定位的词法特征，成稿检查也只能靠人或模型逐段读。写的时候就避开，代价最低。");
        lines.push("");
        for (const rule of sortByLevel(semantic)) {
            lines.push(`- **${rule.title}**：${ruleActionSummary(rule)}`);
            for (const example of rule.examples ?? []) {
                // 对照例（hit=false）必须照样输出：只列反例会让模型连形近的正当写法一起躲开。
                lines.push(example.hit ? `    - 别写成：${example.text}` : `    - 这样写没问题：${example.text}`);
            }
        }
        lines.push("");
    }

    if (principles.length > 0) {
        lines.push("## 写作原则");
        lines.push("");
        for (const rule of sortByLevel(principles)) {
            lines.push(`- **${rule.title}**：${ruleActionSummary(rule)}`);
        }
        lines.push("");
    }

    if (swaps.length > 0) {
        lines.push("## 优先换掉的词");
        lines.push("");
        lines.push("左边是成稿检查会标出的写法，右边是建议的替代。");
        lines.push("");
        lines.push(...groupByNamespace(swaps));
        lines.push("");
    }

    if (removals.length > 0) {
        lines.push("## 直接不用的写法");
        lines.push("");
        lines.push("这些表达在成稿里会被整处删掉，写的时候不要用。");
        lines.push("");
        lines.push(...groupByNamespace(removals));
        lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push(`本清单由 llmlint 从规则包 ${rulesets.join(", ")} 生成：档位 ${tier}，${rules.length} / ${total} 条 active 规则。`);
    lines.push("规则库更新后重新生成即可，不要手工维护这个文件的内容。");
    return lines.join("\n");
}

/** 级别降序（high 先），同级按 id 稳定排序，保证同一配置下输出可复现。 */
function sortByLevel(rules: ActiveRuleRecord[]): ActiveRuleRecord[] {
    return [...rules].sort((left, right) => LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level] || left.id.localeCompare(right.id));
}

/**
 * 词表类规则按 namespace 聚成一行一组。
 *
 * 逐条一行会让 200 条词表占掉 200 行；聚合后同一类词摆在一起，模型也更容易看出这是一类问题。
 */
function groupByNamespace(rules: ActiveRuleRecord[]): string[] {
    const grouped = new Map<string, string[]>();
    for (const rule of rules) {
        grouped.set(rule.namespace, [...(grouped.get(rule.namespace) ?? []), rule.title]);
    }
    return [...grouped.entries()]
        .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
        .map(([namespace, titles]) => `- ${namespace}：${titles.join("；")}`);
}

/** 供 CLI 直接调用的一步：选规则 + 渲染。 */
export function buildGuide(loadedRules: LoadedRules, tier: GuideTier, verdicts: RuleVerdicts): string {
    const selected = selectGuideRules(loadedRules.rules, tier, verdicts);
    return renderGuide(selected, tier, loadedRules.rules.length, loadedRules.summary.rulesets);
}

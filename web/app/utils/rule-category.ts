import type {ActiveRuleRecord} from "../../../skill/src/types";
import type {MessageKey} from "../i18n/messages";

/**
 * 规则分类单源（Task 16 W0 / R3）：区分「LLM 规则 / 有替换的规则 / 无静态替换的规则」。
 * - llm：detector.type === "llm"，纯登记不参与静态扫描（web 端 scan 只跑 regexRules）。
 * - replace：action.type === "replace"，有机械替换候选（fixability auto/candidate 都算）。
 * - suggest：action.type === "suggest"，只报不改，需人工或 LLM 改写。
 */
export type RuleCategory = "llm" | "replace" | "suggest";

/** 判定规则分类（llm 优先于 action 判断：LLM 规则的 action 不参与静态替换语义）。 */
export function ruleCategory(rule: ActiveRuleRecord): RuleCategory {
    if (rule.detector.type === "llm") {
        return "llm";
    }
    return rule.action.type === "replace" ? "replace" : "suggest";
}

/** 分类徽标形态（class 写全字面量供 UnoCSS 静态扫描）。 */
export type RuleCategoryBadge = {
    labelKey: MessageKey;
    cls: string;
};

/** 分类 → 徽标映射：/rules 页与命中卡片共用。 */
export const CATEGORY_BADGE: Record<RuleCategory, RuleCategoryBadge> = {
    llm: {labelKey: "rules.typeLlm", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300"},
    replace: {labelKey: "rules.typeReplace", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300"},
    suggest: {labelKey: "rules.typeSuggest", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"},
};

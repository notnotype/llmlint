import type {ActiveRuleRecord} from "../../../skill/src/types";
import type {MessageKey} from "../i18n/messages";

/**
 * 规则分类单源（Task 16 W0 / R3）：区分「语义规则 / 有替换的规则 / 无静态替换的规则」。
 * - semantic：detector.type === "semantic"，纯登记不参与静态扫描（web 端 scan 只跑 regexRules）。
 * - replace：action.type === "replace"，有机械替换候选（fixability auto/candidate 都算）。
 * - suggest：action.type === "suggest"，只报不改，需人工或模型改写。
 */
export type RuleCategory = "semantic" | "replace" | "suggest";

/** 判定规则分类（semantic 优先于 action 判断：语义规则的 action 不参与静态替换语义）。 */
export function ruleCategory(rule: ActiveRuleRecord): RuleCategory {
    // handler 规则无 detector，action 恒为 suggest。
    if (!("detector" in rule)) {
        return "suggest";
    }
    if (rule.detector.type === "semantic") {
        return "semantic";
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
    semantic: {labelKey: "rules.typeSemantic", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300"},
    replace: {labelKey: "rules.typeReplace", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300"},
    suggest: {labelKey: "rules.typeSuggest", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"},
};

import type {MessageKey} from "../i18n/messages";

/**
 * verdict 徽标单源（Task 16 W0）：/rules 页、命中卡片、inline 规则菜单共用。
 * 值集来自评测报告 RuleStat.verdict（strong|weak|noise|anti|insufficient），
 * stat 缺失（join miss）归为 untested。class 写全字面量让 UnoCSS 静态扫描到。
 */
export type VerdictBadge = {
    /** 徽标文案 key（复用既有 rules.verdict*）。 */
    labelKey: MessageKey;
    /** 徽标本体配色（背景+文字）。 */
    cls: string;
    /** 卡片主体色：左边框 accent（配 border-l-4 使用）。 */
    borderCls: string;
};

/** 未测徽标（stat 为 null 的 join miss，或报告出现未知 verdict 时兜底）。 */
export const UNTESTED_BADGE: VerdictBadge = {
    labelKey: "rules.verdictUntested",
    cls: "border border-[var(--border-color)] text-[var(--text-muted)]",
    borderCls: "border-l-zinc-300 dark:border-l-zinc-600",
};

/** verdict → 徽标映射（自 RulesCatalogTable 迁出为单源）。 */
export const VERDICT_BADGE: Record<string, VerdictBadge> = {
    strong: {labelKey: "rules.verdictStrong", cls: "bg-emerald-600 text-white", borderCls: "border-l-emerald-500"},
    weak: {labelKey: "rules.verdictWeak", cls: "bg-amber-500 text-white", borderCls: "border-l-amber-400"},
    noise: {labelKey: "rules.verdictNoise", cls: "bg-zinc-400 text-white", borderCls: "border-l-zinc-300 dark:border-l-zinc-500"},
    anti: {labelKey: "rules.verdictAnti", cls: "bg-red-600 text-white", borderCls: "border-l-red-500"},
    insufficient: {labelKey: "rules.verdictInsufficient", cls: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300", borderCls: "border-l-zinc-200 dark:border-l-zinc-700"},
};

/** 取 verdict 对应徽标；null/undefined/未知值一律归未测。 */
export function verdictBadge(verdict: string | null | undefined): VerdictBadge {
    if (!verdict) {
        return UNTESTED_BADGE;
    }
    return VERDICT_BADGE[verdict] ?? UNTESTED_BADGE;
}

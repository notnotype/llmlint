import type {Fixability, NormalizedRuleOverride, Review, RuleLevel} from "../../../skill/src/types";
import type {SupportedLocale} from "../i18n/messages";
import {supportedLocales} from "../i18n/messages";
import type {LlmlintTheme} from "./theme/theme-tokens";
import type {ReviewEditorMode} from "./review-ranges";

export type WebRuleOverride = NormalizedRuleOverride;

export type LlmlintWebSettings = {
    locale: SupportedLocale;
    theme: LlmlintTheme;
    review: Review | "all";
    minLevel: RuleLevel;
    namespaces: string[];
    scanAll: boolean;
    highlight: boolean;
    /** 只读版本视图的检测器热力图层开关（Task 15 P1-C；报告缩略条不受它控制）。 */
    heatmap: boolean;
    /** 编辑器（preview 模式）内的检测器热力底色开关（Task 16 R6）：块坐标经 piece-table 投影跟随草稿编辑；与只读视图的 heatmap 键独立。默认关。 */
    editorHeatmap: boolean;
    /** 校对批注行内建议层开关（Task 15 P2-E 7b）：可自动修复命中在预览正文行内显示删除线 + 建议文本，点击即应用；默认开。 */
    proofreadMarks: boolean;
    /** 编辑器「修改痕迹」diff 层开关（Task 16 R5）：显示草稿 vs head 的本轮未提交改动；AI 改写审阅横幅打开时由宿主强制显示不受此键约束。默认关。 */
    draftDiff: boolean;
    reviewEditorMode: ReviewEditorMode;
    workbenchReportWidth: number;
    /** 检测工作台右栏宽度 px（Task 19 D 分栏可拖拽；与 playground 的 workbenchReportWidth 独立记忆）。 */
    contributeReportWidth: number;
    reviewCommentPanelWidth: number;
    namespaceOverrides: Record<string, WebRuleOverride>;
    ruleOverrides: Record<string, WebRuleOverride>;
};

const THEMES = new Set<LlmlintTheme>(["system", "light", "dark", "sepia"]);
const FILTER_REVIEWS = new Set<Review | "all">(["agent", "human", "none", "all"]);
const RULE_REVIEWS = new Set<Review>(["agent", "human", "none"]);
const LEVELS = new Set<RuleLevel>(["high", "medium", "low"]);
const FIXABILITIES = new Set<Fixability>(["auto", "candidate", "manual"]);

export const defaultWebSettings: LlmlintWebSettings = {
    locale: "zh-CN",
    theme: "system",
    review: "agent",
    minLevel: "low",
    namespaces: [],
    scanAll: false,
    highlight: true,
    heatmap: true,
    editorHeatmap: false,
    proofreadMarks: true,
    draftDiff: false,
    // Task 16 走查改默认：inline 规则菜单/校对批注/热力/diff 全是预览模式能力，source 起步会全部不可见。
    reviewEditorMode: "preview",
    workbenchReportWidth: 560,
    contributeReportWidth: 560,
    reviewCommentPanelWidth: 320,
    namespaceOverrides: {},
    ruleOverrides: {},
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOverride(value: unknown): WebRuleOverride | null {
    if (!isObject(value)) {
        return null;
    }
    const result: WebRuleOverride = {};
    if (typeof value.enabled === "boolean") {
        result.enabled = value.enabled;
    }
    if (LEVELS.has(value.level as RuleLevel)) {
        result.level = value.level as RuleLevel;
    }
    if (RULE_REVIEWS.has(value.review as Review)) {
        result.review = value.review as Review;
    }
    if (FIXABILITIES.has(value.fixability as Fixability)) {
        result.fixability = value.fixability as Fixability;
    }
    return Object.keys(result).length > 0 ? result : null;
}

function normalizeOverrideRecord(value: unknown): Record<string, WebRuleOverride> {
    if (!isObject(value)) {
        return {};
    }
    const result: Record<string, WebRuleOverride> = {};
    for (const [key, item] of Object.entries(value)) {
        const normalized = normalizeOverride(item);
        if (key.trim() && normalized) {
            result[key] = normalized;
        }
    }
    return result;
}

export function normalizeWebSettings(value: unknown): LlmlintWebSettings {
    if (!isObject(value)) {
        return {...defaultWebSettings};
    }
    return {
        locale: supportedLocales.includes(value.locale as SupportedLocale) ? value.locale as SupportedLocale : defaultWebSettings.locale,
        theme: THEMES.has(value.theme as LlmlintTheme) ? value.theme as LlmlintTheme : defaultWebSettings.theme,
        review: FILTER_REVIEWS.has(value.review as Review | "all") ? value.review as Review | "all" : defaultWebSettings.review,
        minLevel: LEVELS.has(value.minLevel as RuleLevel) ? value.minLevel as RuleLevel : defaultWebSettings.minLevel,
        namespaces: Array.isArray(value.namespaces) ? value.namespaces.filter((item): item is string => typeof item === "string") : [],
        scanAll: typeof value.scanAll === "boolean" ? value.scanAll : defaultWebSettings.scanAll,
        highlight: typeof value.highlight === "boolean" ? value.highlight : defaultWebSettings.highlight,
        heatmap: typeof value.heatmap === "boolean" ? value.heatmap : defaultWebSettings.heatmap,
        editorHeatmap: typeof value.editorHeatmap === "boolean" ? value.editorHeatmap : defaultWebSettings.editorHeatmap,
        proofreadMarks: typeof value.proofreadMarks === "boolean" ? value.proofreadMarks : defaultWebSettings.proofreadMarks,
        draftDiff: typeof value.draftDiff === "boolean" ? value.draftDiff : defaultWebSettings.draftDiff,
        reviewEditorMode: value.reviewEditorMode === "preview" || value.reviewEditorMode === "source" ? value.reviewEditorMode : defaultWebSettings.reviewEditorMode,
        workbenchReportWidth: normalizePanelWidth(value.workbenchReportWidth, defaultWebSettings.workbenchReportWidth, 360, 960),
        contributeReportWidth: normalizePanelWidth(value.contributeReportWidth, defaultWebSettings.contributeReportWidth, 360, 960),
        reviewCommentPanelWidth: normalizePanelWidth(value.reviewCommentPanelWidth, defaultWebSettings.reviewCommentPanelWidth, 260, 560),
        namespaceOverrides: normalizeOverrideRecord(value.namespaceOverrides),
        ruleOverrides: normalizeOverrideRecord(value.ruleOverrides),
    };
}

function normalizePanelWidth(value: unknown, fallback: number, minWidth: number, maxWidth: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(minWidth, Math.min(maxWidth, Math.round(value)));
}

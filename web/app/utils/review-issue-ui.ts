import type {MessageKey} from "../i18n/messages";
import type {ReviewIssueMark} from "./review-ranges";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** 返回命中级别在编辑器 UI 中的短标签。 */
export function reviewIssueLevelLabel(mark: ReviewIssueMark | null, t: Translate): string {
    if (!mark) {
        return "";
    }
    if (mark.level === "high") {
        return t("common.high");
    }
    if (mark.level === "medium") {
        return t("common.medium");
    }
    return t("common.low");
}

/** 返回选区命中条中显示的处理状态，区分候选修复与人工判断。 */
export function reviewIssueActionLabel(mark: ReviewIssueMark | null, t: Translate): string {
    if (!mark) {
        return "";
    }
    if (mark.replacement !== null) {
        const action = mark.replacement === "" ? t("review.deletable") : t("review.replaceable");
        return mark.fixability === "candidate" ? t("issue.candidateApplyAction", {action}) : action;
    }
    if (mark.fixability === "candidate") {
        return t("review.candidate");
    }
    return t("review.manualDecision");
}

/** 返回替换按钮 title，删除型替换不使用空箭头文案。 */
export function reviewReplacementTitle(mark: ReviewIssueMark, t: Translate): string {
    const title = mark.replacement === ""
        ? `${mark.title}: ${t("review.delete")}「${mark.match}」`
        : `${mark.title}: ${mark.match} -> ${mark.replacement}`;
    return mark.fixability === "candidate"
        ? `${t("common.candidate")} · ${title}`
        : title;
}

/** 返回替换按钮正文；toolbar 的应用语境用更自然的候选文案。 */
export function reviewReplacementActionLabel(mark: ReviewIssueMark, t: Translate, options: {applyPrefix?: boolean} = {}): string {
    if (options.applyPrefix && mark.fixability === "candidate") {
        return mark.replacement === ""
            ? t("review.applyCandidateDelete")
            : t("review.applyCandidateReplace");
    }
    const action = mark.replacement === ""
        ? t(options.applyPrefix ? "review.applyDelete" : "review.delete")
        : t(options.applyPrefix ? "review.applyReplace" : "review.replace");
    return mark.fixability === "candidate"
        ? t("issue.candidateApplyAction", {action})
        : action;
}

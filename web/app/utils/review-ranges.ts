import type {Fixability, Issue, RuleLevel} from "../types";
import type {RepairAnnotation} from "./repair-draft";
import {applySingleIssueReplacement} from "llmlint/fix";

export type ReviewEditorMode = "source" | "preview";

export type ReviewIssueMark = {
    id: string;
    ruleId: string;
    level: RuleLevel;
    from: number;
    to: number;
    title: string;
    match: string;
    replacement: string | null;
    fixability: Fixability;
    /** 规则说明（issue.rule.note）；规则未配置说明时为空 → inline 规则菜单不渲染说明行。 */
    note?: string;
    /** 评测判别裁决（strong/weak/noise/anti/insufficient）；构建未烘评测数据或该规则未入报告时为空 → UI 归「未测」。 */
    verdict?: string;
};

/**
 * 评审批注（持久模型）：锚定不可变原文坐标的 RepairAnnotation + 评审域 provenance。
 * 草稿坐标一律由 projectAnnotations(plan, ...) 现算派生，不落任何持久状态。
 */
export type ReviewAnnotation = RepairAnnotation & {
    source: "user" | "rule";
};

/**
 * 批注在当前草稿上的投影视图（渲染 / prompt 用）。from/to 是**当前草稿**坐标；
 * stale = 批注锚定的原文片段已被编辑改写（草稿中该句非原样）。
 */
export type ReviewComment = {
    id: string;
    from: number;
    to: number;
    quote: string;
    body: string;
    source: "user" | "rule";
    resolved?: boolean;
    stale?: boolean;
};

export type ReviewTextDiff = {
    id: string;
    from: number;
    to: number;
    deleted: string;
    inserted: string;
    source: "static" | "llm";
    title: string;
};

export type ReviewTextSelection = {
    start: number;
    end: number;
    text: string;
    source: ReviewEditorMode;
    mappable: boolean;
    disabledReason?: string;
    anchor?: {
        left: number;
        top: number;
        height: number;
        containerWidth: number;
        containerHeight: number;
        absoluteTop: number;
    };
};

/** 每行在文本中的 UTF-16 起始偏移（含首行 0）。 */
export function utf16LineStarts(text: string): number[] {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === "\n") {
            starts.push(index + 1);
        }
    }
    return starts;
}

/**
 * 把 scanner 的 1-based code point column 反算回 UTF-16 offset。
 */
export function columnToOffset(text: string, lineStarts: number[], line: number, column: number): number {
    let index = lineStarts[line - 1] ?? 0;
    for (let step = 1; step < column; step++) {
        const codePoint = text.codePointAt(index);
        index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    }
    return index;
}

export function issueStartOffset(text: string, issue: Issue): number {
    return columnToOffset(text, utf16LineStarts(text), issue.line, issue.column);
}

export function issueId(issue: Issue): string {
    return [
        issue.rule.id,
        issue.line,
        issue.column,
        issue.endLine,
        issue.endColumn,
        encodeURIComponent(issue.match),
    ].join(":");
}

/**
 * 把命中列表折算成编辑器消费的 mark（draft 坐标 + 预算好的替换文本）。
 * verdicts（可选，Task 16 R2）：ruleId → 评测判别裁决，供 inline 规则菜单显示 verdict 徽标；
 * 不传或查不到该规则时 mark.verdict 为空（UI 归「未测」）。
 */
export function buildReviewIssueMarks(text: string, issues: Issue[], verdicts?: Record<string, string>): ReviewIssueMark[] {
    const lineStarts = utf16LineStarts(text);
    return issues.map((issue) => {
        const from = columnToOffset(text, lineStarts, issue.line, issue.column);
        const replacement = applySingleIssueReplacement(text, issue, from, {
            allowedFixabilities: ["auto", "candidate"],
        });
        return {
            id: issueId(issue),
            ruleId: issue.rule.id,
            level: issue.rule.level,
            from,
            to: from + issue.match.length,
            title: issue.rule.title,
            match: issue.match,
            replacement: replacement?.replacement ?? null,
            fixability: issue.rule.fixability,
            note: issue.rule.note,
            verdict: verdicts?.[issue.rule.id],
        };
    });
}

export function issueAtOffset(text: string, issues: Issue[], offset: number): Issue | null {
    const lineStarts = utf16LineStarts(text);
    for (const issue of issues) {
        const from = columnToOffset(text, lineStarts, issue.line, issue.column);
        if (offset >= from && offset < from + issue.match.length) {
            return issue;
        }
    }
    return null;
}

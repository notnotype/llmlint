import type {CheckSummary, Issue, UiFilters} from "../types";
import type {ReviewComment, ReviewIssueMark, ReviewTextSelection} from "./review-ranges";

const MAX_RULE_GROUPS = 40;
const MAX_EXAMPLES_PER_RULE = 6;
const MAX_COMMENTS = 30;

/**
 * 生成可粘贴给外部 LLM 的临时优化指令。
 * llmlint 目前不直接接 LLM，所以这里把当前可见报告转成一份人工可审的 Markdown prompt。
 */
export function buildLlmOptimizationPrompt(input: {
    text: string;
    issues: Issue[];
    summary: CheckSummary;
    filters: UiFilters;
    comments?: ReviewComment[];
    includeText: boolean;
}): string {
    const groups = groupIssues(input.issues);
    const hiddenGroupCount = Math.max(0, groups.length - MAX_RULE_GROUPS);
    const comments = input.comments ?? [];
    const lines = [
        "# 中文文本优化任务",
        "",
        "你是一名中文文本编辑。请根据下面的 llmlint 检测报告优化文本，目标是减少模板化表达、机械修辞和明显的 AI 味，同时保留原文事实、情节、人物关系、语气和 Markdown 结构。",
        "",
        "## 修改原则",
        "",
        "- llmlint 命中是候选，不是必须全部修改；请结合上下文判断，避免误伤有意的文风。",
        "- 优先处理 high / medium 命中；low 命中只在明显影响自然度时处理。",
        "- 对 replace / 删除建议，可以按上下文改写，不要只做机械替换。",
        "- 不要新增原文没有的信息，不要改人物名、设定名、时间线和叙事视角。",
        "- 如果无法确定某处是否该改，请保守保留。",
        "",
        "## 返回格式",
        "",
        "- 只输出优化后的完整正文，保持原 Markdown 结构。",
        "- 不要输出解释、分析过程、修改清单或额外标题。",
        "- 如果本指令没有附带正文，请先等待用户粘贴正文，不要凭报告自行补写。",
        "",
        "## 当前过滤条件",
        "",
        `- 受众：${input.filters.review}`,
        `- 最低级别：${input.filters.minLevel}`,
        `- 命名空间：${input.filters.namespaces.length > 0 ? input.filters.namespaces.join(", ") : "全部"}`,
        `- Markdown 遮罩：${input.filters.scanAll ? "关闭（扫描全部内容）" : "开启（跳过代码块/frontmatter/链接）"}`,
        "",
        "## 命中汇总",
        "",
        `- 总计：${input.summary.total}`,
        `- high：${input.summary.high}`,
        `- medium：${input.summary.medium}`,
        `- low：${input.summary.low}`,
        "",
        "## 规则命中与优化建议",
        "",
    ];

    if (groups.length === 0) {
        lines.push("当前过滤下没有 llmlint 命中。请只做轻量润色，不要主动大改。", "");
    } else {
        for (const group of groups.slice(0, MAX_RULE_GROUPS)) {
            const rule = group.issues[0]!.rule;
            lines.push(`### ${rule.title} (${group.issues.length} 处)`);
            lines.push("");
            lines.push(`- 规则 ID：\`${rule.id}\``);
            lines.push(`- 命名空间：\`${rule.namespace}\``);
            lines.push(`- 级别：${rule.level}`);
            lines.push(`- 建议：${formatAction(rule.action)}`);
            if (rule.note) {
                lines.push(`- 备注：${rule.note}`);
            }
            lines.push("");
            for (const issue of group.issues.slice(0, MAX_EXAMPLES_PER_RULE)) {
                lines.push(`- L${issue.line}:C${issue.column} 「${compact(issue.match)}」`);
                lines.push(`  - 上下文：${compact(issue.context.before)}【${compact(issue.context.current)}】${compact(issue.context.after)}`);
            }
            const hiddenIssueCount = group.issues.length - MAX_EXAMPLES_PER_RULE;
            if (hiddenIssueCount > 0) {
                lines.push(`- 还有 ${hiddenIssueCount} 处同类命中未展开，请按同一原则处理。`);
            }
            lines.push("");
        }
        if (hiddenGroupCount > 0) {
            lines.push(`还有 ${hiddenGroupCount} 组规则未展开；请优先处理上面列出的高频和高影响命中。`, "");
        }
    }

    if (comments.length > 0) {
        lines.push("## 用户批注", "");
        const unresolved = comments.filter((comment) => comment.resolved !== true);
        const resolved = comments.filter((comment) => comment.resolved === true);
        for (const comment of [...unresolved, ...resolved].slice(0, MAX_COMMENTS)) {
            const position = offsetToLineColumn(input.text, comment.from);
            lines.push(`- L${position.line}:C${position.column} ${comment.resolved ? "（已完成）" : "（待处理）"}「${compact(comment.quote)}」`);
            lines.push(`  - 批注：${compact(comment.body)}`);
        }
        const hiddenCommentCount = comments.length - MAX_COMMENTS;
        if (hiddenCommentCount > 0) {
            lines.push(`- 还有 ${hiddenCommentCount} 条用户批注未展开，请按同一审查意见处理。`);
        }
        lines.push("");
    }

    if (input.includeText) {
        const fence = markdownFence(input.text);
        lines.push("## 待优化正文", "");
        lines.push(`${fence}markdown`);
        lines.push(input.text);
        lines.push(fence);
    } else {
        lines.push("## 正文", "");
        lines.push("本次复制未包含正文。请用户在这份指令后粘贴待优化正文，再开始修改。");
    }

    return lines.join("\n").trimEnd();
}

/**
 * 生成只针对当前选区的外部 LLM 优化指令。
 * 用于 source/preview inline menu，避免用户为了局部改写复制整篇报告。
 */
export function buildSelectionOptimizationPrompt(input: {
    selection: ReviewTextSelection;
    issueMark: ReviewIssueMark | null;
    replacementMark: ReviewIssueMark | null;
    text?: string;
    comments?: ReviewComment[];
}): string {
    const context = input.text && input.selection.mappable
        ? issueContext(input.text, input.selection.start, input.selection.end)
        : null;
    const relatedComments = context
        ? (input.comments ?? [])
            .filter((comment) => comment.to > context.from && comment.from < context.to)
            .slice(0, 8)
        : [];
    const lines = [
        "# 中文片段优化任务",
        "",
        "你是一名中文文本编辑。请根据下面的 llmlint 局部审查信息优化选中文本，目标是减少模板化表达、机械修辞和明显的 AI 味，同时保留原文事实、语气、上下文衔接和 Markdown 片段结构。",
        "",
        "## 返回格式",
        "",
        "- 只输出优化后的片段正文。",
        "- 不要输出解释、分析过程、修改清单或额外标题。",
        "- 如果建议不适合当前上下文，请尽量少改或原样返回。",
        "",
    ];

    if (input.issueMark) {
        lines.push("## 当前命中", "");
        lines.push(`- 规则：${input.issueMark.title}`);
        lines.push(`- 级别：${input.issueMark.level}`);
        lines.push(`- 命中：${input.issueMark.match}`);
        lines.push(`- 处理：${input.issueMark.replacement !== null ? input.issueMark.replacement === "" ? "建议删除或自然改写" : `可参考替换为「${input.issueMark.replacement}」` : input.issueMark.fixability === "candidate" ? "候选命中，请结合上下文判断" : "需人工判断"}`);
        lines.push("");
    }

    if (input.replacementMark && input.replacementMark.id !== input.issueMark?.id) {
        lines.push("## 可自动替换命中", "");
        lines.push(`- 规则：${input.replacementMark.title}`);
        lines.push(`- 命中：${input.replacementMark.match}`);
        lines.push(`- 建议：${input.replacementMark.replacement === "" ? "删除" : input.replacementMark.replacement}`);
        lines.push("");
    }

    lines.push("## 选中文本", "");
    const fence = markdownFence(input.selection.text);
    lines.push(`${fence}markdown`);
    lines.push(input.selection.text);
    lines.push(fence);

    if (context && context.text !== input.selection.text) {
        const contextFence = markdownFence(context.text);
        lines.push("", "## 选区上下文", "");
        lines.push(`${contextFence}markdown`);
        lines.push(context.text);
        lines.push(contextFence);
        lines.push("", "请只返回选中文本对应的优化结果，不要返回整段上下文。");
    }

    if (relatedComments.length > 0) {
        lines.push("", "## 相关用户批注", "");
        for (const comment of relatedComments) {
            lines.push(`- ${comment.resolved ? "（已完成）" : "（待处理）"}「${compact(comment.quote)}」`);
            lines.push(`  - 批注：${compact(comment.body)}`);
        }
    }

    return lines.join("\n").trimEnd();
}

/**
 * 生成只针对当前规则命中的外部 LLM 优化指令。
 * 用于右侧列表/正文定位到某条命中后，不需要用户再次框选文本也能复制局部优化上下文。
 */
export function buildIssueOptimizationPrompt(input: {
    text: string;
    issueMark: ReviewIssueMark;
    comments?: ReviewComment[];
}): string {
    const context = issueContext(input.text, input.issueMark.from, input.issueMark.to);
    const relatedComments = (input.comments ?? [])
        .filter((comment) => comment.to > context.from && comment.from < context.to)
        .slice(0, 8);
    const lines = [
        "# 中文局部命中优化任务",
        "",
        "你是一名中文文本编辑。请只根据下面这一处 llmlint 命中和上下文，给出更自然的局部改写，目标是减少模板化表达、机械修辞和明显的 AI 味，同时保留原文事实、语气和 Markdown 片段结构。",
        "",
        "## 返回格式",
        "",
        "- 只输出优化后的局部片段正文。",
        "- 不要输出解释、分析过程、修改清单或额外标题。",
        "- 如果这条命中在当前上下文里不需要修改，请原样返回命中所在的局部片段。",
        "",
        "## 当前命中",
        "",
        `- 规则：${input.issueMark.title}`,
        `- 级别：${input.issueMark.level}`,
        `- 命中：${input.issueMark.match}`,
        `- 处理：${formatIssueTreatment(input.issueMark)}`,
        "",
        "## 命中上下文",
        "",
    ];

    const fence = markdownFence(context.text);
    lines.push(`${fence}markdown`);
    lines.push(context.text);
    lines.push(fence);

    if (relatedComments.length > 0) {
        lines.push("", "## 相关用户批注", "");
        for (const comment of relatedComments) {
            lines.push(`- ${comment.resolved ? "（已完成）" : "（待处理）"}「${compact(comment.quote)}」`);
            lines.push(`  - 批注：${compact(comment.body)}`);
        }
    }

    return lines.join("\n").trimEnd();
}

function groupIssues(issues: Issue[]): Array<{ruleId: string; issues: Issue[]}> {
    const groups = new Map<string, Issue[]>();
    for (const issue of issues) {
        const existing = groups.get(issue.rule.id);
        if (existing) {
            existing.push(issue);
        } else {
            groups.set(issue.rule.id, [issue]);
        }
    }
    return [...groups.entries()]
        .map(([ruleId, ruleIssues]) => ({ruleId, issues: ruleIssues}))
        .sort((left, right) => right.issues.length - left.issues.length);
}

function formatAction(action: Issue["rule"]["action"]): string {
    if (action.type === "suggest") {
        return action.message;
    }
    if (action.replacements.length === 1 && action.replacements[0] === "") {
        return "建议删除命中片段，或按上下文改写为更自然的表达。";
    }
    return `可参考替换：${action.replacements.map((item) => item === "" ? "删除" : `「${item}」`).join(" / ")}`;
}

function formatIssueTreatment(issueMark: ReviewIssueMark): string {
    if (issueMark.replacement !== null) {
        return issueMark.replacement === ""
            ? "建议删除或结合上下文自然改写。"
            : `可参考替换为「${issueMark.replacement}」，也可以按上下文更自然地改写。`;
    }
    if (issueMark.fixability === "candidate") {
        return "候选命中，请结合上下文判断是否需要修改。";
    }
    return "需人工判断，请优先保证文意和语气。";
}

function issueContext(text: string, from: number, to: number): {from: number; to: number; text: string} {
    const boundedFrom = Math.max(0, Math.min(text.length, from));
    const boundedTo = Math.max(boundedFrom, Math.min(text.length, to));
    const start = lineBoundaryBefore(text, boundedFrom, 2);
    const end = lineBoundaryAfter(text, boundedTo, 2);
    return {from: start, to: end, text: text.slice(start, end)};
}

function lineBoundaryBefore(text: string, offset: number, lineCount: number): number {
    let index = Math.max(0, Math.min(text.length, offset));
    for (let line = 0; line < lineCount; line += 1) {
        const previous = text.lastIndexOf("\n", Math.max(0, index - 1));
        if (previous < 0) {
            return 0;
        }
        index = previous;
    }
    const boundary = text.lastIndexOf("\n", Math.max(0, index - 1));
    return boundary < 0 ? 0 : boundary + 1;
}

function lineBoundaryAfter(text: string, offset: number, lineCount: number): number {
    let index = Math.max(0, Math.min(text.length, offset));
    for (let line = 0; line < lineCount; line += 1) {
        const next = text.indexOf("\n", index);
        if (next < 0) {
            return text.length;
        }
        index = next + 1;
    }
    const boundary = text.indexOf("\n", index);
    return boundary < 0 ? text.length : boundary;
}

function compact(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function offsetToLineColumn(text: string, offset: number): {line: number; column: number} {
    const boundedOffset = Math.max(0, Math.min(text.length, offset));
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < boundedOffset; index += 1) {
        if (text.charCodeAt(index) === 10) {
            line += 1;
            lineStart = index + 1;
        }
    }
    return {line, column: boundedOffset - lineStart + 1};
}

function markdownFence(text: string): string {
    const matches = text.match(/`+/g) ?? [];
    const longest = matches.reduce((max, item) => Math.max(max, item.length), 2);
    return "`".repeat(longest + 1);
}

import {applyAutoFixWithChanges, type AutoFixChange} from "llmlint/fix";
import {computeMaskedRanges} from "llmlint/markdown-mask";
import {formatCheckReport} from "llmlint/reporter";
import {prepareScanContext} from "llmlint/scan-context";
import {scanHandlerRules, scanText, scanWithContext} from "llmlint/scanner";
import {scanDensity} from "llmlint/density";
import type {ActiveHandlerRuleRecord, DensityRuleRecord, Issue, LoadedRules, RegexRuleRecord, Review, RuleLevel} from "llmlint/types";
import type {LlmAnalysisReport, LlmRuleHit} from "#shared/agent-harness";
import type {AnalysisStatus} from "#shared/analysis";
import type {RepairRuleVerdict} from "#shared/rule-profile";
import {defineCapability} from "@notnotype/neuro-agent-harness";
import registryData from "../../../app/data/registry.json";

const DEFAULT_READ_LINES = 2000;
const MAX_READ_BYTES = 64 * 1024;
const MAX_CHECK_ISSUES = 50;
const MAX_TOOL_TEXT_BYTES = 64 * 1024;
const MAX_HEATMAP_CHUNKS = 500;

export type RevisionSelector = "current" | {ordinal: number} | {revisionId: string};

export type RevisionTextDocument = {
    revisionId: string;
    ordinal: number;
    body: string;
};

export type WorkspaceReadCoverage = {
    /** 1-based 行号。 */
    line: number;
    /** 该行内 UTF-16 半开区间。空行使用 0..0 表示已访问。 */
    start: number;
    end: number;
};

export type DetectionHeatmap = {
    detectorName: string;
    detectorVersion: string;
    docPAi: number;
    maxPAi: number | null;
    chunkChars: number;
    checkedAt: string;
    chunks: Array<{span: {start: number; end: number}; pAi: number}>;
};

export type RevisionDetectionRecords = {
    status: {scan: AnalysisStatus; llmReview: AnalysisStatus; detectors: AnalysisStatus};
    scan: null | {
        engineVersion: string;
        docScore: number;
        scannedAt: string;
        hits: Array<{ruleId: string; span: {start: number; end: number}; level: string; review: string}>;
    };
    llmReview: null | {
        model: string;
        promptVersion: string;
        score: number;
        confidence: number;
        hits: LlmRuleHit[];
        report: LlmAnalysisReport;
        judgedAt: string;
    };
    detectors: DetectionHeatmap[];
};

/** Revision 数据读取 seam；Prisma 与测试 fake 分别作为 Adapter。 */
export interface RevisionTextSource {
    /** 返回 Session 绑定的持久化 Revision。 */
    current(): Promise<RevisionTextDocument>;
    /** 解析当前 Text 谱系内的历史 Revision；跨 Text 或不存在必须拒绝。 */
    revision(selector: Exclude<RevisionSelector, "current">): Promise<RevisionTextDocument>;
    /** 返回指定已揭示 Revision 的三路持久化检测事实。 */
    detections(revisionId: string): Promise<RevisionDetectionRecords>;
}

export interface RevisionTextSourceResolver {
    /** 为指定且属于当前 Session Text 的 Revision 建立 invocation-scoped source。 */
    forRevision(revisionId: string): Promise<RevisionTextSource>;
}

/** Profile 获取 Revision 文本与检测数据的宿主能力。 */
export const llmlintRevisionTextSource = defineCapability<"llmlint.revisionTextSource", RevisionTextSourceResolver>("llmlint.revisionTextSource");

export type WorkspaceEdit = {oldText: string; newText: string; reason?: string};

export type WorkspaceEditResult = {
    body: string;
    edits: WorkspaceEdit[];
    diff: string;
    firstChangedLine: number;
};

export type WorkspaceLintResult = {
    report: string;
    issues: WorkspaceLintIssue[];
    /** 全量必修命中，不受工具展示 50 条上限影响；finish 使用它做结果约束。 */
    requiredIssues: WorkspaceLintIssue[];
    truncated: boolean;
};

export type RepairRulePolicy = {
    required: boolean;
    reason: "strong" | "sensitive_vocabulary" | "weak" | "contextual";
    /** null 表示当前评测报告没有该规则的判别裁决。 */
    verdict: RepairRuleVerdict | null;
    /** null 表示当前评测报告没有有效 lift。 */
    effectiveLift: number | null;
};

export type WorkspaceLintIssue = Issue & {repairPolicy: RepairRulePolicy};

export type WorkspaceFixResult = {
    body: string;
    changes: AutoFixChange[];
    diff: string;
    firstChangedLine: number | null;
};

type RegistrySnapshot = {
    summary: LoadedRules["summary"];
    diagnostics: LoadedRules["diagnostics"];
    regexRules: RegexRuleRecord[];
    densityRules: DensityRuleRecord[];
    handlerRules: ActiveHandlerRuleRecord[];
    /** eval report 缺失时构建脚本合法省略；此时非词汇规则降级为 contextual。 */
    ruleVerdicts?: Record<string, {verdict: RepairRuleVerdict; effectiveLift: number | null}>;
};

// registry.json 是构建期生成的外部 JSON，需在此收口为服务端只读快照类型。
const registry = registryData as unknown as RegistrySnapshot;
const registryRuleById = new Map([...registry.regexRules, ...registry.handlerRules].map((rule) => [rule.id, rule]));
const loadedRules: LoadedRules = {
    rules: [...registry.regexRules, ...registry.densityRules, ...registry.handlerRules],
    regexRules: registry.regexRules,
    semanticRules: [],
    densityRules: registry.densityRules,
    handlerRules: registry.handlerRules,
    diagnostics: registry.diagnostics,
    summary: registry.summary,
};

/**
 * 一次 Invocation 的 Revision 文本工作区。
 * 历史 Revision 永远只读；所有写操作只改变内存工作副本，由 Profile 决定如何持久化编辑事实。
 */
export class RevisionTextWorkspace {
    readonly current: RevisionTextDocument;
    private readonly source: RevisionTextSource;
    private workingBody: string;
    private selectionStart: number | null;
    private selectionEnd: number | null;

    constructor(options: {
        current: RevisionTextDocument;
        source: RevisionTextSource;
        /** 缺省等于 current.body；Optimize 可传尚未提交的编辑器草稿。 */
        workingBody?: string;
        selection?: {from: number; to: number};
    }) {
        this.current = options.current;
        this.source = options.source;
        this.workingBody = options.workingBody ?? options.current.body;
        this.selectionStart = options.selection?.from ?? null;
        this.selectionEnd = options.selection?.to ?? null;
    }

    /** 当前完整工作副本。 */
    get body(): string {
        return this.workingBody;
    }

    /** 工作副本是否已经偏离持久化基底 Revision。 */
    get dirty(): boolean {
        return this.workingBody !== this.current.body;
    }

    /** 按行读取当前工作副本或同一 Text 的历史 Revision。 */
    async read(input: {
        revision?: RevisionSelector;
        offset?: number;
        limit?: number;
        /** 从 offset 指定行的 UTF-16 字符位置继续读取；用于单行超过字节预算的正文。 */
        characterOffset?: number;
        lineNumbers?: boolean;
    } = {}): Promise<{content: string; revisionId: string; ordinal: number; startLine: number; endLine: number; totalLines: number; coverage: WorkspaceReadCoverage[]; nextOffset?: number; nextCharacterOffset?: number; truncated: boolean}> {
        const document = await this.resolve(input.revision);
        const lines = document.body.split("\n");
        const start = Math.max(0, (input.offset ?? 1) - 1);
        if (start >= lines.length) throw new Error(`offset 超出正文范围：正文共 ${lines.length} 行`);
        const characterOffset = input.characterOffset ?? 0;
        if (!Number.isInteger(characterOffset) || characterOffset < 0 || characterOffset > lines[start]!.length) throw new Error("characterOffset 超出目标行范围");
        const requestedLimit = input.limit ?? DEFAULT_READ_LINES;
        const selected: Array<{line: number; text: string; start: number; end: number}> = [];
        let bytes = 0;
        let truncated = false;
        let nextOffset: number | undefined;
        let nextCharacterOffset: number | undefined;
        const maxIndex = Math.min(lines.length, start + requestedLimit);
        for (let index = start; index < maxIndex; index += 1) {
            const originalLine = lines[index]!;
            const lineStart = index === start ? characterOffset : 0;
            const line = originalLine.slice(lineStart);
            const prefix = `${index + 1} | `;
            const nextBytes = Buffer.byteLength(prefix + line, "utf-8") + (selected.length > 0 ? 1 : 0);
            if (bytes + nextBytes > MAX_READ_BYTES - 96) {
                truncated = true;
                if (selected.length === 0) {
                    const fragment = utf8Prefix(line, MAX_READ_BYTES - Buffer.byteLength(prefix, "utf-8") - 160);
                    selected.push({line: index + 1, text: fragment, start: lineStart, end: lineStart + fragment.length});
                    nextOffset = index + 1;
                    nextCharacterOffset = lineStart + fragment.length;
                } else {
                    nextOffset = index + 1;
                }
                break;
            }
            selected.push({line: index + 1, text: line, start: lineStart, end: originalLine.length});
            bytes += nextBytes;
        }
        const endLine = selected.at(-1)?.line ?? start + 1;
        const hasMore = nextOffset !== undefined || endLine < lines.length;
        if (nextOffset === undefined && endLine < lines.length) nextOffset = endLine + 1;
        truncated ||= hasMore && selected.length < requestedLimit;
        const showLines = input.lineNumbers ?? (input.offset !== undefined || input.limit !== undefined || input.characterOffset !== undefined || truncated || hasMore);
        const content = showLines
            ? selected.map((item) => `${item.line} | ${item.text}`).join("\n")
            : selected.map((item) => item.text).join("\n");
        return {
            content,
            revisionId: document.revisionId,
            ordinal: document.ordinal,
            startLine: start + 1,
            endLine,
            totalLines: lines.length,
            coverage: selected.map((item) => ({line: item.line, start: item.start, end: item.end})),
            ...(nextOffset !== undefined ? {nextOffset} : {}),
            ...(nextCharacterOffset !== undefined ? {nextCharacterOffset} : {}),
            truncated,
        };
    }

    /** 使用同一调用前快照完成一组唯一且不重叠的精确替换。 */
    async edit(input: {revision?: RevisionSelector; edits: WorkspaceEdit[]}): Promise<WorkspaceEditResult> {
        this.assertWritable(input.revision);
        if (input.edits.length === 0) throw new Error("edits 至少需要一项替换");
        const before = this.workingBody;
        const matches = input.edits.map((edit, index) => {
            if (!edit.oldText) throw new Error(`edits[${index}].oldText 不能为空`);
            if (edit.oldText === edit.newText) throw new Error(`edits[${index}] 没有产生修改`);
            const positions = allIndexes(before, edit.oldText);
            if (positions.length !== 1) throw new Error(`edits[${index}].oldText 命中 ${positions.length} 处，必须唯一`);
            const start = positions[0]!;
            const end = start + edit.oldText.length;
            this.assertInsideSelection(start, end);
            return {edit, start, end};
        }).sort((left, right) => left.start - right.start);
        for (let index = 1; index < matches.length; index += 1) {
            if (matches[index]!.start < matches[index - 1]!.end) throw new Error("edits 中的替换区域互相重叠");
        }
        let next = before;
        for (const match of [...matches].reverse()) {
            next = next.slice(0, match.start) + match.edit.newText + next.slice(match.end);
        }
        this.updateSelection(matches.map(({start, end, edit}) => ({start, end, insertedLength: edit.newText.length})));
        this.workingBody = next;
        return {
            body: next,
            edits: input.edits,
            diff: unifiedLineDiff(before, next),
            firstChangedLine: firstChangedLine(before, next),
        };
    }

    /** 运行与 CLI check 同源的扫描，并同时返回文本报告和结构化命中。 */
    async lintCheck(input: {revision?: RevisionSelector; minLevel?: RuleLevel; review?: Review | "all"; showLines?: boolean} = {}): Promise<WorkspaceLintResult> {
        const document = await this.resolve(input.revision);
        const review = input.review ?? "agent";
        const minLevel = input.minLevel ?? "low";
        const ctx = prepareScanContext(document.body, {maskedRanges: computeMaskedRanges(document.body)});
        const all = [...scanWithContext(ctx, registry.regexRules), ...scanHandlerRules(ctx, registry.handlerRules)];
        const allDensity = scanDensity(ctx, registry.densityRules);
        const reviewFiltered = review === "all" ? all : all.filter((issue) => issue.rule.review === review);
        const densityReviewFiltered = review === "all" ? allDensity : allDensity.filter((issue) => issue.rule.review === review);
        const minRank = levelRank(minLevel);
        const visible = reviewFiltered.filter((issue) => levelRank(issue.rule.level) >= minRank);
        const visibleDensity = densityReviewFiltered.filter((issue) => levelRank(issue.rule.level) >= minRank);
        const enriched = visible.map((issue): WorkspaceLintIssue => ({
            ...issue,
            repairPolicy: repairPolicy(issue.rule.id, issue.rule.namespace),
        }));
        const issues = enriched.slice(0, MAX_CHECK_ISSUES);
        const densityIssues = visibleDensity.slice(0, MAX_CHECK_ISSUES);
        const baseReport = formatCheckReport(`revision:${document.ordinal}`, issues, loadedRules, {
            review,
            minLevel,
            hiddenByReview: all.length - (review === "all" ? all.length : reviewFiltered.length),
            hiddenByLevel: reviewFiltered.length - visible.length,
            showLines: input.showLines ?? true,
            color: false,
            densityIssues,
        });
        const visibleTotal = visible.length + visibleDensity.length;
        const shownTotal = issues.length + densityIssues.length;
        const omission = visibleTotal > shownTotal
            ? `\n\n[结果预算：总命中 ${visibleTotal} 条，当前展示 ${shownTotal} 条，省略 ${visibleTotal - shownTotal} 条]`
            : "";
        const report = truncateUtf8(baseReport + omission, MAX_TOOL_TEXT_BYTES);
        return {
            report: report.text,
            issues,
            requiredIssues: enriched.filter((issue) => issue.repairPolicy.required),
            truncated: visibleTotal > shownTotal || report.truncated,
        };
    }

    /** 只将 fixability:auto 机械修复应用到当前工作副本。 */
    async lintFix(input: {revision?: RevisionSelector} = {}): Promise<WorkspaceFixResult> {
        this.assertWritable(input.revision);
        const before = this.workingBody;
        const autoRules = registry.regexRules.filter((rule) => rule.fixability === "auto");
        const scopeStart = this.selectionStart ?? 0;
        const scopeEnd = this.selectionEnd ?? before.length;
        const scope = before.slice(scopeStart, scopeEnd);
        const fixed = applyAutoFixWithChanges(scope, autoRules, computeMaskedRanges(scope));
        if (fixed.fixed === scope) return {body: before, changes: [], diff: "", firstChangedLine: null};
        this.workingBody = before.slice(0, scopeStart) + fixed.fixed + before.slice(scopeEnd);
        if (this.selectionEnd !== null) this.selectionEnd += fixed.fixed.length - scope.length;
        const changes = fixed.changes.map((change) => ({...change, from: change.from + scopeStart, to: change.to + scopeStart}));
        return {
            body: this.workingBody,
            changes,
            diff: unifiedLineDiff(before, this.workingBody),
            firstChangedLine: firstChangedLine(before, this.workingBody),
        };
    }

    /** 返回指定 Revision 的持久化 regex、LLM 与 AIGC 检测记录。 */
    async revisionDetections(input: {revision?: RevisionSelector} = {}): Promise<{
        revisionId: string;
        ordinal: number;
        stale: boolean;
        chunksOmitted: number;
        status: RevisionDetectionRecords["status"];
        scan: RevisionDetectionRecords["scan"] extends infer T ? T extends null ? never : T & {hits: Array<{ruleId: string; span: {start: number; end: number}; level: string; review: string; startLine: number; endLine: number; repairPolicy: RepairRulePolicy}>; hitsOmitted: number} | null : never;
        llmReview: RevisionDetectionRecords["llmReview"];
        detectors: Array<{
            detectorName: string;
            detectorVersion: string;
            chunkChars: number;
            docPAi: number;
            maxPAi: number | null;
            checkedAt: string;
            chunksOmitted: number;
            chunks: Array<{span: {start: number; end: number}; pAi: number; startLine: number; endLine: number}>;
        }>;
    }> {
        const selector = input.revision ?? "current";
        const document = selector === "current" ? this.current : await this.source.revision(selector);
        const records = await this.source.detections(document.revisionId);
        const detectors = records.detectors;
        let remainingChunks = MAX_HEATMAP_CHUNKS;
        const projected = detectors.map((detector) => {
            const included = detector.chunks.slice(0, remainingChunks);
            remainingChunks -= included.length;
            return {
                detectorName: detector.detectorName,
                detectorVersion: detector.detectorVersion,
                chunkChars: detector.chunkChars,
                docPAi: detector.docPAi,
                maxPAi: detector.maxPAi,
                checkedAt: detector.checkedAt,
                chunksOmitted: detector.chunks.length - included.length,
                chunks: included.map((chunk) => ({
                    ...chunk,
                    startLine: lineAtOffset(document.body, chunk.span.start),
                    endLine: lineAtOffset(document.body, Math.max(chunk.span.start, chunk.span.end - 1)),
                })),
            };
        });
        return {
            revisionId: document.revisionId,
            ordinal: document.ordinal,
            stale: selector === "current" && this.dirty,
            chunksOmitted: detectors.reduce((sum, detector) => sum + detector.chunks.length, 0) - (MAX_HEATMAP_CHUNKS - remainingChunks),
            status: records.status,
            scan: records.scan ? {
                ...records.scan,
                hitsOmitted: Math.max(0, records.scan.hits.length - MAX_CHECK_ISSUES),
                hits: records.scan.hits.slice(0, MAX_CHECK_ISSUES).map((hit) => ({
                    ...hit,
                    startLine: lineAtOffset(document.body, hit.span.start),
                    endLine: lineAtOffset(document.body, Math.max(hit.span.start, hit.span.end - 1)),
                    repairPolicy: repairPolicy(hit.ruleId, registryRuleById.get(hit.ruleId)?.namespace ?? ""),
                })),
            } : null,
            llmReview: records.llmReview,
            detectors: projected,
        };
    }

    private async resolve(selector: RevisionSelector = "current"): Promise<RevisionTextDocument> {
        if (selector === "current") return {...this.current, body: this.workingBody};
        return this.source.revision(selector);
    }

    private assertWritable(selector: RevisionSelector = "current"): void {
        if (selector !== "current") throw new Error("历史 Revision 只读；edit/lint_fix 只能修改 current 工作副本");
    }

    private assertInsideSelection(start: number, end: number): void {
        if (this.selectionStart === null || this.selectionEnd === null) return;
        if (start < this.selectionStart || end > this.selectionEnd) throw new Error("替换超出本次选区范围");
    }

    private updateSelection(edits: Array<{start: number; end: number; insertedLength: number}>): void {
        if (this.selectionEnd === null) return;
        for (const edit of edits) this.selectionEnd += edit.insertedLength - (edit.end - edit.start);
    }
}

/** 将评测判别力和词汇 namespace 收敛为 Agent 可执行的修复优先级。 */
function repairPolicy(ruleId: string, namespace: string): RepairRulePolicy {
    const signal = registry.ruleVerdicts?.[ruleId];
    if (namespace === "vocabulary" || namespace.startsWith("vocabulary.")) {
        return {required: true, reason: "sensitive_vocabulary", verdict: signal?.verdict ?? null, effectiveLift: signal?.effectiveLift ?? null};
    }
    if (signal?.verdict === "strong") {
        return {required: true, reason: "strong", verdict: signal.verdict, effectiveLift: signal.effectiveLift};
    }
    const rule = registryRuleById.get(ruleId);
    if (ruleId.startsWith("story-deslop.") && rule?.level === "high") {
        return {required: true, reason: "strong", verdict: signal?.verdict ?? null, effectiveLift: signal?.effectiveLift ?? null};
    }
    if (signal?.verdict === "weak") {
        return {required: false, reason: "weak", verdict: signal.verdict, effectiveLift: signal.effectiveLift};
    }
    return {required: false, reason: "contextual", verdict: signal?.verdict ?? null, effectiveLift: signal?.effectiveLift ?? null};
}

function allIndexes(text: string, search: string): number[] {
    const positions: number[] = [];
    let cursor = 0;
    while (cursor <= text.length - search.length) {
        const index = text.indexOf(search, cursor);
        if (index === -1) break;
        positions.push(index);
        cursor = index + Math.max(1, search.length);
    }
    return positions;
}

function firstChangedLine(before: string, after: string): number {
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    const count = Math.max(beforeLines.length, afterLines.length);
    for (let index = 0; index < count; index += 1) {
        if (beforeLines[index] !== afterLines[index]) return index + 1;
    }
    return 1;
}

function unifiedLineDiff(before: string, after: string): string {
    if (before === after) return "";
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    let prefix = 0;
    while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
    let beforeSuffix = beforeLines.length;
    let afterSuffix = afterLines.length;
    while (beforeSuffix > prefix && afterSuffix > prefix && beforeLines[beforeSuffix - 1] === afterLines[afterSuffix - 1]) {
        beforeSuffix -= 1;
        afterSuffix -= 1;
    }
    return [
        "--- current",
        "+++ working",
        `@@ -${prefix + 1},${beforeSuffix - prefix} +${prefix + 1},${afterSuffix - prefix} @@`,
        ...beforeLines.slice(prefix, beforeSuffix).map((line) => `-${line}`),
        ...afterLines.slice(prefix, afterSuffix).map((line) => `+${line}`),
    ].join("\n");
}

function lineAtOffset(text: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < Math.min(offset, text.length); index += 1) if (text.charCodeAt(index) === 10) line += 1;
    return line;
}

function levelRank(level: RuleLevel): number {
    if (level === "high") return 3;
    if (level === "medium") return 2;
    return 1;
}

function truncateUtf8(value: string, maxBytes: number): {text: string; truncated: boolean} {
    if (Buffer.byteLength(value, "utf-8") <= maxBytes) return {text: value, truncated: false};
    let end = Math.min(value.length, maxBytes);
    while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf-8") > maxBytes - 80) end -= 1;
    return {text: `${value.slice(0, end)}\n\n[报告超过 ${maxBytes} bytes，后续命中已省略]`, truncated: true};
}

function utf8Prefix(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, "utf-8") <= maxBytes) return value;
    let end = Math.min(value.length, maxBytes);
    while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf-8") > maxBytes) end -= 1;
    return value.slice(0, end);
}

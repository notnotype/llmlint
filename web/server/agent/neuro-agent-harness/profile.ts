import type {JsonObject, JsonValue, SessionWritePlan} from "@notnotype/neuro-agent-harness";
import {defineProfile, defineSchema, defineTool, type AgentProfile, type PreparedRun, type ProfilePrepareContext, type RuntimeHookContext, type ToolDefinition, type ToolExecutionContext} from "@notnotype/neuro-agent-harness";
import type {AgentInvokeRequest, AgentEdit, LlmAnalysisReport, LlmRuleHit} from "#shared/agent-harness";
import {repairPrompt} from "../../../../evals/generator/prompts";
import {llmRulesPrompt} from "../../../../evals/generator/llm-rules-prompt";
import {llmRiskScore} from "../llm-risk-score";
import {llmlintAnalysisContext, type LlmlintAnalysisContext} from "./analysis-context";
import {llmlintRevisionTextSource, RevisionTextWorkspace, type RevisionSelector, type WorkspaceEdit, type WorkspaceLintIssue, type WorkspaceReadCoverage} from "./revision-text-workspace";

const MAX_TURNS = 64;
const MAX_TOKENS_CAP = 65_536;
const REWRITE_PROMPT_VERSION = "repair-agent-v5";
const ANALYSIS_PROMPT_VERSION = "llm-rules-agent-v6";

export interface LlmlintSessionInitial extends JsonObject {
    revisionId: string;
    userId: number;
}

export interface LlmlintOptimizeResult extends JsonObject {
    body: string;
    edits: AgentEdit[];
    partial: boolean;
    summary: string;
}

export interface LlmlintAnalysisResult extends JsonObject {
    report: LlmAnalysisReport;
    hits: LlmRuleHit[];
    score: number;
    model: string;
    promptVersion: string;
}

export type LlmlintProfileOutput = LlmlintOptimizeResult | LlmlintAnalysisResult;

export interface LlmlintProfileOptions {
    readonly repairModelKey?: string;
    readonly analysisModelKey?: string;
}

type LlmlintHarnessPayload = AgentInvokeRequest & JsonObject;

/** llmlint 的 NeuroAgentHarness Profile：统一编排 Revision 工作区、检测工具和终态输出。 */
export function createLlmlintProfile(options: LlmlintProfileOptions = {}): AgentProfile<
    LlmlintSessionInitial,
    LlmlintHarnessPayload,
    LlmlintProfileOutput,
    string,
    LlmlintSessionInitial,
    {modelKey: string; maxTokensCap: number}
> {
    const repairModelKey = options.repairModelKey;
    return defineProfile({
        manifest: {key: "llmlint.review", name: "llmlint Agent"},
        initial: objectSchema<LlmlintSessionInitial>(value => {
            const object = asObject(value);
            const revisionId = requiredString(object.revisionId, "revisionId");
            const userId = requiredInteger(object.userId, "userId");
            return {revisionId, userId};
        }),
        payload: objectSchema<LlmlintHarnessPayload>(value => parsePayload(value)),
        output: objectSchema<LlmlintProfileOutput>(value => parseOutput(value)),
        requiredCapabilities: [llmlintAnalysisContext, llmlintRevisionTextSource],
        hooks: [{
            name: "preserve-partial-optimize-on-failure",
            stage: "settleFailure" as const,
            run(context) {
                const output = partialOptimizeResult(context, context.signal.aborted ? "用户取消，保留已完成修改" : "运行失败，保留已完成修改");
                return output ? {output} : {};
            },
        }, {
            name: "preserve-partial-optimize-on-incomplete-stop",
            stage: "settleRun" as const,
            run(context) {
                if (context.terminationReason === "tool_terminate") return {};
                const summary = context.terminationReason === "max_turns"
                    ? "达到最大轮次，保留已完成修改"
                    : "模型自然停止，保留已完成修改";
                const output = partialOptimizeResult(context, summary);
                return output ? {output} : {};
            },
        }],
        async prepare(context) {
            if (context.payload.phase === "analysis") return prepareAnalysis(context, requiredModelKey(options.analysisModelKey ?? repairModelKey));
            const request = context.payload;
            const selection = request.selection;
            if (selection && request.body.slice(selection.from, selection.to) !== selection.text) {
                throw new Error("选区已变化，请重新选择后再发送");
            }
            const instruction = request.message?.trim() || "请优化当前文本，保持原意、人物声音和上下文衔接。";
            const source = await context.capabilities.require(llmlintRevisionTextSource).forRevision(request.revisionId);
            const current = await source.current();
            const originalBody = request.body;
            const edits: AgentEdit[] = [];
            let summary = "";
            const workspace = new RevisionTextWorkspace({
                current,
                source,
                workingBody: originalBody,
                ...(selection ? {selection: {from: selection.from, to: selection.to}} : {}),
            });
            const tools = createOptimizeTools({
                workspace,
                edits,
                objective: request.objective,
                get summary() { return summary; },
                set summary(value: string) { summary = value; },
            });
            const systemPrompt = repairPrompt(REWRITE_PROMPT_VERSION).system;
            const userMessage = selection
                ? `用户要求：${instruction}\n\n仅修改下面选区，不得改动选区外文本：\n${selection.text}`
                : `用户要求：${instruction}\n\n正文位于 current 工作副本中，请按任务需要自由调用工具。`;
            return {
                systemPrompt,
                userMessage,
                modelConfig: {modelKey: requiredModelKey(repairModelKey), maxTokensCap: MAX_TOKENS_CAP},
                tools,
                limits: {maxTurns: MAX_TURNS},
                prepareWrites: transcriptWrites(context, systemPrompt),
            };
        },
    });
}

/** 从 durable edit entries 重建不完整 optimize 的可审阅结果。 */
function partialOptimizeResult(
    context: RuntimeHookContext<string, LlmlintSessionInitial>,
    summary: string,
): LlmlintOptimizeResult | undefined {
    const invocation = context.snapshot.invocations.find((item) => item.id === context.invocationId);
    if (!invocation) return undefined;
    const request = parsePayload(invocation.input);
    if (request.phase !== "optimize") return undefined;
    const edits = context.snapshot.entries
        .filter((entry) => entry.kind === "llmlint.edit" && entry.invocationId === context.invocationId)
        .map((entry) => parseEdit(entry.payload));
    if (edits.length === 0) return undefined;
    const workspaceEntry = context.snapshot.entries.findLast((entry) => entry.kind === "llmlint.workspace" && entry.invocationId === context.invocationId);
    const workspacePayload = workspaceEntry ? asObject(workspaceEntry.payload) : {};
    const body = requiredString(workspacePayload.body, "llmlint.workspace.body");
    return {body, edits, partial: true, summary};
}

type OptimizeState = {
    readonly workspace: RevisionTextWorkspace;
    readonly edits: AgentEdit[];
    readonly objective?: "polish_ai_risk";
    summary: string;
};

async function prepareAnalysis(
    context: ProfilePrepareContext<LlmlintSessionInitial, LlmlintHarnessPayload, string, LlmlintSessionInitial>,
    modelKey: string,
): Promise<PreparedRun<string, LlmlintSessionInitial, {modelKey: string; maxTokensCap: number}>> {
    const analysis = await context.capabilities.require(llmlintAnalysisContext).load(context.payload.revisionId);
    const source = await context.capabilities.require(llmlintRevisionTextSource).forRevision(context.payload.revisionId);
    const current = await source.current();
    const workspace = new RevisionTextWorkspace({current: {...current, body: analysis.body}, source});
    const readCoverage = new AnalysisReadCoverage();
    let lintChecked = false;
    const hits: LlmRuleHit[] = [];
    const userText = "请完成本篇文本的 LLM 规则检查并提交报告。先调用 lint_check 获取带行号的确定性扫描报告，再用 read 读完正文；结合上下文记录确定命中的 LLM 规则，最后提交报告。";
    return {
        systemPrompt: llmRulesPrompt(ANALYSIS_PROMPT_VERSION).system,
        userMessage: userText,
        modelConfig: {modelKey, maxTokensCap: MAX_TOKENS_CAP},
        tools: createAnalysisTools({analysis, workspace, modelKey, readCoverage, hits, get lintChecked() { return lintChecked; }, set lintChecked(value: boolean) { lintChecked = value; }}),
        limits: {maxTurns: MAX_TURNS},
        prepareWrites: transcriptWrites(context, llmRulesPrompt(ANALYSIS_PROMPT_VERSION).system),
    };
}

/** 保存宿主原始要求与实际 System Prompt；模型用户消息由 Core agent.message 作为 transcript 真相源。 */
function transcriptWrites(
    context: ProfilePrepareContext<LlmlintSessionInitial, LlmlintHarnessPayload, string, LlmlintSessionInitial>,
    systemPrompt: string,
): readonly SessionWritePlan<string, LlmlintSessionInitial>[] {
    const text = typeof context.payload.message === "string" ? context.payload.message.trim() : "";
    return [{
        target: context.sessionId,
        expectedVersion: context.snapshot.version,
        cause: "llmlint.transcript",
        operations: [{type: "appendEntries", entries: [
            {kind: "llmlint.system", invocationId: context.invocationId, payload: {text: systemPrompt}},
            ...(text ? [{kind: "llmlint.request", invocationId: context.invocationId, payload: {text}}] : []),
        ]}],
    }];
}

type AnalysisState = {
    readonly analysis: LlmlintAnalysisContext;
    readonly workspace: RevisionTextWorkspace;
    readonly modelKey: string;
    readonly readCoverage: AnalysisReadCoverage;
    readonly hits: LlmRuleHit[];
    lintChecked: boolean;
};

/** 精确记录 Analysis 已读取的逐行 UTF-16 区间，避免超长单行被提前视为全文已读。 */
class AnalysisReadCoverage {
    private readonly visited = new Set<number>();
    private readonly ranges = new Map<number, Array<{start: number; end: number}>>();

    /** 合并一次 current read 返回的可信覆盖区间。 */
    add(coverage: readonly WorkspaceReadCoverage[]): void {
        for (const item of coverage) {
            this.visited.add(item.line);
            const ranges = [...(this.ranges.get(item.line) ?? []), {start: item.start, end: item.end}]
                .sort((left, right) => left.start - right.start);
            const merged: Array<{start: number; end: number}> = [];
            for (const range of ranges) {
                const previous = merged.at(-1);
                if (!previous || range.start > previous.end) merged.push({...range});
                else if (range.end > previous.end) previous.end = range.end;
            }
            this.ranges.set(item.line, merged);
        }
    }

    /** 返回仍未访问完整的行数和 UTF-16 字符数。 */
    missing(body: string): {lines: number; characters: number} {
        const lines = body.split("\n");
        let missingLines = 0;
        let missingCharacters = 0;
        for (let index = 0; index < lines.length; index += 1) {
            const lineNumber = index + 1;
            const lineLength = lines[index]!.length;
            if (!this.visited.has(lineNumber)) {
                missingLines += 1;
                missingCharacters += lineLength;
                continue;
            }
            let cursor = 0;
            let lineMissing = 0;
            for (const range of this.ranges.get(lineNumber) ?? []) {
                if (range.start > cursor) lineMissing += range.start - cursor;
                if (range.end > cursor) cursor = range.end;
            }
            if (cursor < lineLength) lineMissing += lineLength - cursor;
            if (lineMissing > 0) missingLines += 1;
            missingCharacters += lineMissing;
        }
        return {lines: missingLines, characters: missingCharacters};
    }
}

function createAnalysisTools(state: AnalysisState): readonly ToolDefinition<JsonValue, string, LlmlintSessionInitial>[] {
    const read = createReadTool(state.workspace, result => state.readCoverage.add(result.coverage));
    const lintCheck = createLintCheckTool(state.workspace, () => { state.lintChecked = true; }, state.analysis.rulesText);
    const detections = createRevisionDetectionsTool(state.workspace);
    const recordHit = defineTool<JsonValue, string, LlmlintSessionInitial>({
        name: "record_rule_hit",
        description: "记录一处确定命中的 LLM 规则。quote 必须逐字摘自正文。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {type: "object", properties: {ruleId: {type: "string"}, quote: {type: "string"}, reason: {type: "string"}}, required: ["ruleId", "quote", "reason"], additionalProperties: false}),
        execute(argumentsValue) {
            const parsed = parseRuleHitArguments(asObject(argumentsValue), state.analysis.body, state.analysis.ruleIds);
            if (!parsed.ok) return {content: parsed.error, isError: true};
            if (!state.hits.some((hit) => hit.ruleId === parsed.hit.ruleId && hit.quote === parsed.hit.quote)) state.hits.push(parsed.hit);
            return {content: `已记录 ${parsed.hit.ruleId}：${parsed.hit.quote}`};
        },
    });
    const report = defineTool<JsonValue, string, LlmlintSessionInitial>({
        name: "report_result",
        description: "全文检查完成后提交结构化规则审查报告，并结束分析。风险分由服务器计算。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {type: "object", properties: {confidence: {type: "number", minimum: 0, maximum: 1}, conclusion: {type: "string"}, suggestions: {type: "array"}}, required: ["confidence", "conclusion", "suggestions"], additionalProperties: false}),
        executionMode: "sequential" as const,
        execute(argumentsValue, context) {
            if (!state.lintChecked) return {content: "尚未调用 lint_check，不能提交报告。", isError: true};
            const missing = state.readCoverage.missing(state.workspace.body);
            if (missing.lines > 0) return {content: `尚有 ${missing.lines} 行、${missing.characters} 个 UTF-16 字符未读取，不能提交报告。`, isError: true};
            const parsed = parseAnalysisReport(asObject(argumentsValue), state.hits);
            if (!parsed.ok) return {content: parsed.error, isError: true};
            const score = llmRiskScore(state.analysis.body, state.hits, state.analysis.ruleLevels);
            const output: LlmlintAnalysisResult = {report: {...parsed.report, score}, hits: state.hits, score, model: state.modelKey, promptVersion: ANALYSIS_PROMPT_VERSION};
            return {content: "结构化分析报告已接收。", terminate: true, output, writePlans: [{target: context.sessionId, expectedVersion: context.snapshot.version, cause: "llmlint.analysis.report", operations: [{type: "appendEntries", entries: [{kind: "llmlint.report", invocationId: context.invocationId, payload: {report: output.report, hits: output.hits}}]}]}]};
        },
    });
    return [read, lintCheck, detections, recordHit, report];
}

function createOptimizeTools(state: OptimizeState): readonly ToolDefinition<JsonValue, string, LlmlintSessionInitial>[] {
    const read = createReadTool(state.workspace);
    const detections = createRevisionDetectionsTool(state.workspace);
    const lintCheck = createLintCheckTool(state.workspace);
    const edit = createEditTool(state, "llmlint.optimize.edit");
    const finish = defineTool<JsonValue, string, LlmlintSessionInitial>({
        name: "finish",
        description: "全部修改完成后调用，结束本轮改写。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {
            type: "object",
            properties: {summary: {type: "string"}},
            additionalProperties: false,
        }),
        executionMode: "sequential" as const,
        async execute(argumentsValue) {
            if (state.edits.length === 0) return {content: "本轮没有产生任何修改，不能生成成功改写结果。", isError: true};
            if (state.objective === "polish_ai_risk") {
                const lint = await state.workspace.lintCheck({review: "all", minLevel: "low", showLines: true});
                if (lint.requiredIssues.length > 0) {
                    const requirements = lint.requiredIssues.slice(0, 50).map((issue) => {
                        const kind = issue.repairPolicy.reason === "strong" ? "强判别" : "AI 敏感词";
                        return `- [${kind}] ${issue.rule.id} @ ${issue.line}:${issue.column}：${issue.match}`;
                    }).join("\n");
                    const omitted = lint.requiredIssues.length > 50 ? `\n[另有 ${lint.requiredIssues.length - 50} 条必修命中省略]` : "";
                    return {content: `必修规则尚未处理，不能 finish。\n${requirements}${omitted}`, isError: true};
                }
            }
            const argumentsObject = asObject(argumentsValue);
            state.summary = typeof argumentsObject.summary === "string" ? argumentsObject.summary : "";
            const output: LlmlintOptimizeResult = {body: state.workspace.body, edits: state.edits, partial: false, summary: state.summary};
            return {content: "本轮改写已结束。", terminate: true, output};
        },
    });
    if (state.objective === "polish_ai_risk") return [read, detections, lintCheck, edit, finish];
    return [read, detections, lintCheck, createLintFixTool(state), edit, finish];
}

/** 构造通用 Revision 正文读取工具。 */
function createReadTool(workspace: RevisionTextWorkspace, onRead?: (result: Awaited<ReturnType<RevisionTextWorkspace["read"]>>) => void, before?: () => string | null, after?: (result: Awaited<ReturnType<RevisionTextWorkspace["read"]>>) => void, sequential = false): ToolDefinition<JsonValue, string, LlmlintSessionInitial> {
    return defineTool({
        name: "read",
        description: "读取当前工作副本或同一 Text 的历史 Revision 正文。默认 current；历史版本只读。支持 offset/limit 分页，lineNumbers=true 强制显示行号。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {
            type: "object",
            properties: {
                revision: revisionSelectorSchema(),
                offset: {type: "integer", minimum: 1},
                limit: {type: "integer", minimum: 1},
                characterOffset: {type: "integer", minimum: 0},
                lineNumbers: {type: "boolean"},
            },
            additionalProperties: false,
        }),
        executionMode: sequential ? "sequential" : "parallel",
        async execute(argumentsValue) {
            const blocked = before?.();
            if (blocked) return {content: blocked, isError: true};
            const value = asObject(argumentsValue);
            const result = await workspace.read({
                revision: parseRevisionSelector(value.revision),
                ...(typeof value.offset === "number" ? {offset: value.offset} : {}),
                ...(typeof value.limit === "number" ? {limit: value.limit} : {}),
                ...(typeof value.characterOffset === "number" ? {characterOffset: value.characterOffset} : {}),
                ...(typeof value.lineNumbers === "boolean" ? {lineNumbers: value.lineNumbers} : {}),
            });
            if ((parseRevisionSelector(value.revision) ?? "current") === "current") onRead?.(result);
            after?.(result);
            return {content: result.content, details: jsonDetails(result)};
        },
    });
}

/** 构造 CLI 同源扫描工具。 */
function createLintCheckTool(workspace: RevisionTextWorkspace, onCheck?: () => void, rulesText?: string, before?: () => string | null, sequential = false): ToolDefinition<JsonValue, string, LlmlintSessionInitial> {
    return defineTool({
        name: "lint_check",
        description: "运行与 llmlint CLI check 同源的确定性扫描，返回含规则、级别、行列、命中文本和 action 的报告。默认检查 current 工作副本。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {
            type: "object",
            properties: {
                revision: revisionSelectorSchema(),
                minLevel: {type: "string", enum: ["low", "medium", "high"]},
                review: {type: "string", enum: ["agent", "human", "none", "all"]},
                showLines: {type: "boolean"},
            },
            additionalProperties: false,
        }),
        executionMode: sequential ? "sequential" : "parallel",
        async execute(argumentsValue) {
            const blocked = before?.();
            if (blocked) return {content: blocked, isError: true};
            const value = asObject(argumentsValue);
            const result = await workspace.lintCheck({
                revision: parseRevisionSelector(value.revision),
                ...(isRuleLevel(value.minLevel) ? {minLevel: value.minLevel} : {}),
                ...(isReview(value.review) ? {review: value.review} : {}),
                ...(typeof value.showLines === "boolean" ? {showLines: value.showLines} : {}),
            });
            onCheck?.();
            const suffix = rulesText ? `\n\n本轮 LLM 规则：\n${rulesText}` : "";
            const priorities = result.issues.map((issue) => {
                const label = issue.repairPolicy.reason === "strong"
                    ? "必修：强判别"
                    : issue.repairPolicy.reason === "sensitive_vocabulary"
                        ? "必修：AI 敏感词"
                        : issue.repairPolicy.reason === "weak"
                            ? "酌情：弱判别"
                            : "参考";
                return `- [${label}] ${issue.rule.id} @ ${issue.line}:${issue.column}`;
            }).join("\n");
            const prioritySection = priorities ? `\n\n修复优先级：\n${priorities}` : "";
            return {content: result.report + prioritySection + suffix, details: jsonDetails({issues: result.issues.map(compactIssue), requiredCount: result.requiredIssues.length, truncated: result.truncated})};
        },
    });
}

/** 构造指定 Revision 三路持久化检测记录读取工具。 */
function createRevisionDetectionsTool(workspace: RevisionTextWorkspace, before?: () => string | null, after?: () => void, sequential = false): ToolDefinition<JsonValue, string, LlmlintSessionInitial> {
    return defineTool({
        name: "get_revision_detections",
        description: "读取指定已揭示 Revision 的持久化 regex scan、LLM review 与逐检测器原始 AIGC 热力图。不会现场触发检测。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {type: "object", properties: {revision: revisionSelectorSchema()}, additionalProperties: false}),
        executionMode: sequential ? "sequential" : "parallel",
        async execute(argumentsValue) {
            const blocked = before?.();
            if (blocked) return {content: blocked, isError: true};
            const result = await workspace.revisionDetections({revision: parseRevisionSelector(asObject(argumentsValue).revision)});
            after?.();
            const lines = [
                `Revision #${result.ordinal} 持久化检测状态：regex=${result.status.scan}, llm=${result.status.llmReview}, aigc=${result.status.detectors}`,
                ...(result.scan ? [`regex ${result.scan.engineVersion}: docScore=${result.scan.docScore.toFixed(4)}, 展示 ${result.scan.hits.length} 条命中${result.scan.hitsOmitted > 0 ? `，省略 ${result.scan.hitsOmitted} 条` : ""}`] : ["regex scan：暂无记录"]),
                ...(result.llmReview ? [`LLM ${result.llmReview.model}: score=${result.llmReview.score}, confidence=${result.llmReview.confidence.toFixed(4)}, ${result.llmReview.report.conclusion}`] : ["LLM review：暂无记录"]),
                ...result.detectors.flatMap((detector) => [
                `${detector.detectorName}@${detector.detectorVersion}: docPAi=${detector.docPAi.toFixed(4)}, maxPAi=${detector.maxPAi?.toFixed(4) ?? "-"}`,
                ...detector.chunks.map((chunk) => `  lines ${chunk.startLine}-${chunk.endLine}, span ${chunk.span.start}-${chunk.span.end}, pAi=${chunk.pAi.toFixed(4)}`),
                ...(detector.chunksOmitted > 0 ? [`  [另有 ${detector.chunksOmitted} 个 chunk 因工具结果上限省略]`] : []),
                ]),
            ];
            if (result.detectors.length === 0) lines.push("AIGC detectors：暂无记录");
            if (result.stale) lines.unshift("注意：热力图对应持久化基底 Revision；当前工作副本已修改，结果可能过期。");
            return {content: lines.join("\n"), details: jsonDetails(result)};
        },
    });
}

/** 构造批量精确编辑工具，并把成功修改写成 durable edit facts。 */
function createEditTool(state: OptimizeState, cause: string): ToolDefinition<JsonValue, string, LlmlintSessionInitial> {
    return defineTool({
        name: "edit",
        description: "使用一组精确文本替换修改 current 工作副本。每个 oldText 必须在调用前正文中唯一，各替换不得重叠；历史 Revision 只读。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {
            type: "object",
            properties: {
                revision: revisionSelectorSchema(),
                edits: {type: "array", minItems: 1, items: {type: "object", properties: {oldText: {type: "string"}, newText: {type: "string"}, reason: {type: "string"}}, required: ["oldText", "newText"], additionalProperties: false}},
            },
            required: ["edits"],
            additionalProperties: false,
        }),
        executionMode: "sequential",
        async execute(argumentsValue, context) {
            const value = asObject(argumentsValue);
            const edits = parseWorkspaceEdits(value.edits);
            const result = await state.workspace.edit({revision: parseRevisionSelector(value.revision), edits});
            const projected = result.edits.map((item): AgentEdit => ({oldText: item.oldText, newText: item.newText, reason: item.reason ?? null}));
            state.edits.push(...projected);
            return {
                content: `已完成 ${projected.length} 处替换。\n${result.diff}`,
                details: jsonDetails({diff: result.diff, firstChangedLine: result.firstChangedLine}),
                writePlans: [editWritePlan(context, projected, cause, state.workspace.body)],
            };
        },
    });
}

/** 构造只执行 fixability:auto 的安全机械修复工具。 */
function createLintFixTool(state: OptimizeState, before?: () => string | null, after?: () => void): ToolDefinition<JsonValue, string, LlmlintSessionInitial> {
    return defineTool({
        name: "lint_fix",
        description: "只应用 fixability:auto 的确定性机械修复到 current 工作副本，并返回 diff 与逐规则变更。不会修改 candidate/manual 规则。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {type: "object", properties: {revision: revisionSelectorSchema()}, additionalProperties: false}),
        executionMode: "sequential",
        async execute(argumentsValue, context) {
            const blocked = before?.();
            if (blocked) return {content: blocked, isError: true};
            const result = await state.workspace.lintFix({revision: parseRevisionSelector(asObject(argumentsValue).revision)});
            after?.();
            if (result.changes.length === 0) return {content: "没有可应用的 auto 机械修复。", details: jsonDetails({changes: [], diff: ""})};
            const edits = result.changes.map((change): AgentEdit => ({oldText: change.deleted, newText: change.inserted, reason: `auto:${change.ruleId}`}));
            state.edits.push(...edits);
            return {
                content: `已应用 ${edits.length} 处安全机械修复。\n${result.diff}`,
                details: jsonDetails({changes: result.changes, diff: result.diff, firstChangedLine: result.firstChangedLine}),
                writePlans: [editWritePlan(context, edits, "llmlint.optimize.auto_fix", state.workspace.body)],
            };
        },
    });
}

/** 构造一批 durable edit entry，供刷新恢复、partial result 与 provenance 共用。 */
function editWritePlan(
    context: ToolExecutionContext<string, LlmlintSessionInitial>,
    edits: AgentEdit[],
    cause: string,
    body: string,
): SessionWritePlan<string, LlmlintSessionInitial> {
    return {
        target: context.sessionId,
        expectedVersion: context.snapshot.version,
        cause,
        operations: [{type: "appendEntries", entries: [
            ...edits.map((edit) => ({
                kind: "llmlint.edit",
                invocationId: context.invocationId,
                payload: {
                    oldText: edit.oldText,
                    newText: edit.newText,
                    reason: edit.reason,
                    source: cause.endsWith("auto_fix") ? "static" : "llm",
                    ...(edit.reason?.startsWith("auto:") ? {ruleId: edit.reason.slice("auto:".length)} : {}),
                },
            })),
            {kind: "llmlint.workspace", invocationId: context.invocationId, payload: {body}},
        ]}],
    };
}

/** Revision selector 的 JSON Schema；字符串只接受 current。 */
function revisionSelectorSchema(): JsonObject {
    return {
        oneOf: [
            {type: "string", enum: ["current"]},
            {type: "object", properties: {ordinal: {type: "integer", minimum: 0}}, required: ["ordinal"], additionalProperties: false},
            {type: "object", properties: {revisionId: {type: "string", minLength: 1}}, required: ["revisionId"], additionalProperties: false},
        ],
    };
}

/** 解析模型传入的 Revision selector；缺省保持 current。 */
function parseRevisionSelector(value: JsonValue | undefined): RevisionSelector | undefined {
    if (value === undefined) return undefined;
    if (value === "current") return "current";
    const object = asObject(value);
    if (Number.isInteger(object.ordinal) && typeof object.ordinal === "number" && object.ordinal >= 0) return {ordinal: object.ordinal};
    if (typeof object.revisionId === "string" && object.revisionId.trim()) return {revisionId: object.revisionId};
    throw new Error("revision 必须是 current、{ordinal} 或 {revisionId}");
}

/** 严格解析 edit 的判别联合数组。 */
function parseWorkspaceEdits(value: JsonValue | undefined): WorkspaceEdit[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error("edits 至少需要一项替换");
    return value.map((item, index) => {
        const object = asObject(item);
        const oldText = requiredString(object.oldText, `edits[${index}].oldText`);
        if (typeof object.newText !== "string") throw new Error(`edits[${index}].newText 必须是字符串`);
        const newText = object.newText;
        return {oldText, newText, ...(typeof object.reason === "string" ? {reason: object.reason} : {})};
    });
}

function isRuleLevel(value: JsonValue | undefined): value is "low" | "medium" | "high" {
    return value === "low" || value === "medium" || value === "high";
}

function isReview(value: JsonValue | undefined): value is "agent" | "human" | "none" | "all" {
    return value === "agent" || value === "human" || value === "none" || value === "all";
}

/** Tool details 必须是 JSON；这里通过序列化同时剥离 class/undefined 等非 JSON 值。 */
function jsonDetails(value: object): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** Tool details 不复制完整规则对象，只公开 CLI 消费所需的稳定字段。 */
function compactIssue(issue: WorkspaceLintIssue): object {
    return {
        ruleId: issue.rule.id,
        namespace: issue.rule.namespace,
        title: issue.rule.title,
        level: issue.rule.level,
        review: issue.rule.review,
        fixability: issue.rule.fixability,
        action: issue.rule.action,
        line: issue.line,
        column: issue.column,
        endLine: issue.endLine,
        endColumn: issue.endColumn,
        match: issue.match,
        repairPolicy: issue.repairPolicy,
    };
}

function parsePayload(value: JsonValue): LlmlintHarnessPayload {
    const object = asObject(value);
    const mode = object.mode === "prompt" || object.mode === "continue" ? object.mode : null;
    const phase = object.phase === "analysis" || object.phase === "optimize" ? object.phase : null;
    if (!mode || !phase) throw new Error("Agent payload.mode/phase 无效");
    const revisionId = requiredString(object.revisionId, "revisionId");
    if (phase === "analysis") return {mode, phase, revisionId} as LlmlintHarnessPayload;
    const body = requiredString(object.body, "body");
    const parsed: AgentInvokeRequest = {
        mode,
        phase,
        revisionId,
        body,
        ...(object.objective === "polish_ai_risk" ? {objective: object.objective} : {}),
        ...(typeof object.message === "string" ? {message: object.message} : {}),
        ...(object.selection !== undefined ? {selection: parseSelection(object.selection)} : {}),
    };
    return parsed as LlmlintHarnessPayload;
}

function requiredModelKey(value: string | undefined): string {
    if (!value?.trim()) throw new Error("llmlint Profile 缺少 repairModelKey");
    return value;
}

function parseOutput(value: JsonValue): LlmlintProfileOutput {
    const object = asObject(value);
    if (object.report !== undefined) return parseAnalysisOutput(object);
    const body = requiredString(object.body, "output.body");
    if (!Array.isArray(object.edits)) throw new Error("output.edits 必须是数组");
    const edits = object.edits.map((item, index) => {
        const edit = asObject(item);
        if (typeof edit.newText !== "string") throw new Error(`output.edits[${index}].newText 必须是字符串`);
        return {
            oldText: requiredString(edit.oldText, `output.edits[${index}].oldText`),
            newText: edit.newText,
            reason: typeof edit.reason === "string" ? edit.reason : null,
        };
    });
    return {body, edits, partial: object.partial === true, summary: typeof object.summary === "string" ? object.summary : ""};
}

function parseAnalysisOutput(object: JsonObject): LlmlintAnalysisResult {
    const reportObject = asObject(object.report ?? null);
    const hitsValue = object.hits;
    if (!Array.isArray(hitsValue)) throw new Error("output.hits 必须是数组");
    const hits = hitsValue.map(parseHitValue);
    const score = typeof object.score === "number" ? object.score : requiredNumber(reportObject.score, "output.report.score");
    const confidence = requiredNumber(reportObject.confidence, "output.report.confidence");
    const conclusion = requiredString(reportObject.conclusion, "output.report.conclusion");
    const suggestions = parseStringArray(reportObject.suggestions, "output.report.suggestions");
    const evidence = Array.isArray(reportObject.evidence) ? reportObject.evidence.map((item) => {
        const evidenceObject = asObject(item);
        return {quote: requiredString(evidenceObject.quote, "output.report.evidence.quote"), reason: requiredString(evidenceObject.reason, "output.report.evidence.reason"), ruleIds: parseStringArray(evidenceObject.ruleIds, "output.report.evidence.ruleIds")};
    }) : [];
    return {
        report: {score, confidence, conclusion, evidence, suggestions},
        hits,
        score,
        model: requiredString(object.model, "output.model"),
        promptVersion: requiredString(object.promptVersion, "output.promptVersion"),
    };
}

/** 供宿主投影层复用 Profile 的 analysis output 验证合同。 */
export function parseLlmlintAnalysisResult(value: JsonValue): LlmlintAnalysisResult {
    return parseAnalysisOutput(asObject(value));
}

function parseRuleHitArguments(object: JsonObject, body: string, ruleIds: ReadonlySet<string>): {ok: true; hit: LlmRuleHit} | {ok: false; error: string} {
    const ruleId = object.ruleId;
    const quote = object.quote;
    const reason = object.reason;
    if (typeof ruleId !== "string" || !ruleIds.has(ruleId)) return {ok: false, error: "ruleId 不在 LLM 规则清单中"};
    if (typeof quote !== "string" || quote.length === 0 || quote.length > 120 || typeof reason !== "string" || reason.length === 0) return {ok: false, error: "quote/reason 形状不合法"};
    const start = body.indexOf(quote);
    if (start < 0) return {ok: false, error: "quote 未在正文中逐字找到，请重新摘录"};
    return {ok: true, hit: {ruleId, quote, reason, span: {start, end: start + quote.length}}};
}

function parseAnalysisReport(object: JsonObject, hits: readonly LlmRuleHit[]): {ok: true; report: Omit<LlmAnalysisReport, "score">} | {ok: false; error: string} {
    const confidence = object.confidence;
    const conclusion = object.conclusion;
    const suggestions = object.suggestions;
    if (typeof confidence !== "number" || confidence < 0 || confidence > 1 || typeof conclusion !== "string" || conclusion.length === 0) return {ok: false, error: "confidence/conclusion 不合法"};
    if (!Array.isArray(suggestions) || suggestions.length > 5 || !suggestions.every((item) => typeof item === "string" && item.length > 0)) return {ok: false, error: "suggestions 数量不合法"};
    if (hits.length === 0 && suggestions.length > 0) return {ok: false, error: "没有记录规则命中时，suggestions 必须为空数组"};
    return {ok: true, report: {confidence, conclusion, evidence: hits.slice(0, 8).map((hit) => ({quote: hit.quote, reason: hit.reason, ruleIds: [hit.ruleId]})), suggestions: suggestions as string[]}};
}

function parseHitValue(value: JsonValue): LlmRuleHit {
    const object = asObject(value);
    const spanValue = object.span;
    const span = spanValue === null ? null : asObject(spanValue ?? null);
    return {
        ruleId: requiredString(object.ruleId, "output.hits.ruleId"),
        quote: requiredString(object.quote, "output.hits.quote"),
        reason: requiredString(object.reason, "output.hits.reason"),
        span: span === null ? null : {start: requiredInteger(span.start, "output.hits.span.start"), end: requiredInteger(span.end, "output.hits.span.end")},
    };
}

function parseStringArray(value: JsonValue | undefined, name: string): string[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${name} 必须是字符串数组`);
    return value;
}

function requiredNumber(value: JsonValue | undefined, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} 必须是数字`);
    return value;
}

function parseEdit(value: JsonValue): AgentEdit {
    const object = asObject(value);
    if (typeof object.newText !== "string") throw new Error("edit.newText 必须是字符串");
    return {
        oldText: requiredString(object.oldText, "edit.oldText"),
        newText: object.newText,
        reason: typeof object.reason === "string" ? object.reason : null,
    };
}

function parseSelection(value: JsonValue): {from: number; to: number; text: string} {
    const object = asObject(value);
    const from = requiredInteger(object.from, "selection.from");
    const to = requiredInteger(object.to, "selection.to");
    const text = requiredString(object.text, "selection.text");
    if (to <= from) throw new Error("selection.to 必须大于 selection.from");
    return {from, to, text};
}

function objectSchema<T extends JsonObject>(parse: (value: JsonValue) => T, jsonSchema?: JsonObject) {
    return defineSchema<T>(parse, jsonSchema ?? {type: "object"});
}

function asObject(value: JsonValue): JsonObject {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("必须是 JSON object");
    return value;
}

function requiredString(value: JsonValue | undefined, name: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
    return value;
}

function requiredInteger(value: JsonValue | undefined, name: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`);
    return value;
}

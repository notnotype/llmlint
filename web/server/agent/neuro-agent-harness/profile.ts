import type {JsonObject, JsonValue, SessionWritePlan} from "@notnotype/neuro-agent-harness";
import {defineProfile, defineSchema, defineTool, type AgentProfile, type PreparedRun, type ProfilePrepareContext, type RuntimeHookContext, type ToolDefinition} from "@notnotype/neuro-agent-harness";
import type {AgentInvokeRequest, AgentEdit, LlmAnalysisReport, LlmRuleHit} from "#shared/agent-harness";
import {repairPrompt} from "../../../../evals/generator/prompts";
import {llmRulesPrompt} from "../../../../evals/generator/llm-rules-prompt";
import {llmRiskScore} from "../llm-risk-score";
import {llmlintAnalysisContext, type LlmlintAnalysisContext} from "./analysis-context";

const MAX_TURNS = 64;
const MAX_EDITS = 64;
const MAX_TOKENS_PER_TURN = 4000;
const REWRITE_PROMPT_VERSION = "repair-agent-v1";

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

/** llmlint 的第一条 NeuroAgentHarness Profile：保持 replace/finish 的原有业务口径。 */
export function createLlmlintProfile(options: LlmlintProfileOptions = {}): AgentProfile<
    LlmlintSessionInitial,
    LlmlintHarnessPayload,
    LlmlintProfileOutput,
    string,
    LlmlintSessionInitial,
    {modelKey: string; maxTokensPerTurn: number}
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
        requiredCapabilities: [llmlintAnalysisContext],
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
        prepare(context) {
            if (context.payload.phase === "analysis") return prepareAnalysis(context, requiredModelKey(options.analysisModelKey ?? repairModelKey));
            const request = context.payload;
            const selection = request.selection;
            if (selection && request.body.slice(selection.from, selection.to) !== selection.text) {
                throw new Error("选区已变化，请重新选择后再发送");
            }
            const instruction = request.message?.trim() || "请优化当前文本，保持原意、人物声音和上下文衔接。";
            const originalBody = request.body;
            let working = selection ? selection.text : originalBody;
            const edits: AgentEdit[] = [];
            let summary = "";
            const tools = createOptimizeTools({
                originalBody,
                selection,
                get working() { return working; },
                set working(value: string) { working = value; },
                edits,
                get summary() { return summary; },
                set summary(value: string) { summary = value; },
            });
            return {
                systemPrompt: repairPrompt(REWRITE_PROMPT_VERSION).system,
                userMessage: selection
                    ? `用户要求：${instruction}\n\n仅修改下面选区，不得改动选区外文本：\n${selection.text}`
                    : `用户要求：${instruction}\n\n当前真实草稿快照：\n${request.body}`,
                modelConfig: {modelKey: requiredModelKey(repairModelKey), maxTokensPerTurn: MAX_TOKENS_PER_TURN},
                tools,
                limits: {maxTurns: MAX_TURNS},
                prepareWrites: requestWrites(context),
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
    let working = request.selection ? request.selection.text : request.body;
    for (const edit of edits) {
        const applied = applyReplace(working, edit.oldText, edit.newText);
        if (applied.ok) working = applied.next;
    }
    const body = request.selection
        ? request.body.slice(0, request.selection.from) + working + request.body.slice(request.selection.to)
        : working;
    return {body, edits, partial: true, summary};
}

type OptimizeState = {
    readonly originalBody: string;
    readonly selection: AgentInvokeRequest["selection"];
    working: string;
    readonly edits: AgentEdit[];
    summary: string;
};

async function prepareAnalysis(
    context: ProfilePrepareContext<LlmlintSessionInitial, LlmlintHarnessPayload, string, LlmlintSessionInitial>,
    modelKey: string,
): Promise<PreparedRun<string, LlmlintSessionInitial, {modelKey: string; maxTokensPerTurn: number}>> {
    const source = context.capabilities.require(llmlintAnalysisContext);
    const analysis = await source.load();
    const inspected = new Set<number>();
    let contextQueried = false;
    const hits: LlmRuleHit[] = [];
    const userText = `请完成本篇文本的 LLM 规则检查并提交报告。正文共 ${analysis.chunks.length} 块。先调用 get_lint_context 查询服务器扫描统计与规则，再逐块读取正文。`;
    return {
        systemPrompt: llmRulesPrompt("llm-rules-agent-v4").system,
        userMessage: userText,
        modelConfig: {modelKey, maxTokensPerTurn: MAX_TOKENS_PER_TURN},
        tools: createAnalysisTools({analysis, modelKey, inspected, hits, get contextQueried() { return contextQueried; }, set contextQueried(value: boolean) { contextQueried = value; }}),
        limits: {maxTurns: MAX_TURNS},
        prepareWrites: requestWrites(context),
    };
}

/** 只把用户原始要求投影到宿主 timeline；完整模型 prompt 留在 agent.message。 */
function requestWrites(
    context: ProfilePrepareContext<LlmlintSessionInitial, LlmlintHarnessPayload, string, LlmlintSessionInitial>,
): readonly SessionWritePlan<string, LlmlintSessionInitial>[] {
    const text = context.payload.message?.trim();
    if (!text) return [];
    return [{
        target: context.sessionId,
        expectedVersion: context.snapshot.version,
        cause: "llmlint.request",
        operations: [{type: "appendEntries", entries: [{kind: "llmlint.request", invocationId: context.invocationId, payload: {text}}]}],
    }];
}

type AnalysisState = {
    readonly analysis: LlmlintAnalysisContext;
    readonly modelKey: string;
    readonly inspected: Set<number>;
    readonly hits: LlmRuleHit[];
    contextQueried: boolean;
};

function createAnalysisTools(state: AnalysisState): readonly ToolDefinition<JsonValue, string, LlmlintSessionInitial>[] {
    const readChunk = defineTool<JsonValue, string, LlmlintSessionInitial>({
        name: "read_document_chunk",
        description: "按编号读取一个正文块。必须读取全部块后才能提交报告。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {type: "object", properties: {index: {type: "integer", minimum: 0}}, required: ["index"], additionalProperties: false}),
        execute(argumentsValue) {
            const index = requiredInteger(asObject(argumentsValue).index, "index");
            if (index >= state.analysis.chunks.length) return {content: `正文块编号无效，可用范围 0-${Math.max(0, state.analysis.chunks.length - 1)}`, isError: true};
            state.inspected.add(index);
            const chunk = state.analysis.chunks[index]!;
            return {content: `正文块 ${index + 1}/${state.analysis.chunks.length}，UTF-16 span=${chunk.start}-${chunk.end}\n${chunk.text}`};
        },
    });
    const lintContext = defineTool<JsonValue, string, LlmlintSessionInitial>({
        name: "get_lint_context",
        description: "查询服务器真实 llmlint 扫描统计与本轮 LLM 规则清单。提交报告前必须调用一次。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {type: "object", additionalProperties: false}),
        execute() {
            state.contextQueried = true;
            return {content: `服务器真实扫描：regex 命中 ${state.analysis.scanStats.hitCount} 处，docScore=${state.analysis.scanStats.docScore.toFixed(1)}。\nLLM 规则：\n${state.analysis.rulesText}`};
        },
    });
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
            if (!state.contextQueried) return {content: "尚未调用 get_lint_context，不能提交报告。", isError: true};
            if (state.inspected.size !== state.analysis.chunks.length) return {content: `尚有 ${state.analysis.chunks.length - state.inspected.size} 个正文块未检查，不能提交报告。`, isError: true};
            const parsed = parseAnalysisReport(asObject(argumentsValue), state.hits);
            if (!parsed.ok) return {content: parsed.error, isError: true};
            const score = llmRiskScore(state.analysis.body, state.hits, state.analysis.ruleLevels);
            const output: LlmlintAnalysisResult = {report: {...parsed.report, score}, hits: state.hits, score, model: state.modelKey, promptVersion: "llm-rules-agent-v4"};
            return {content: "结构化分析报告已接收。", terminate: true, output, writePlans: [{target: context.sessionId, expectedVersion: context.snapshot.version, cause: "llmlint.analysis.report", operations: [{type: "appendEntries", entries: [{kind: "llmlint.report", invocationId: context.invocationId, payload: {report: output.report, hits: output.hits}}]}]}]};
        },
    });
    return [readChunk, lintContext, recordHit, report];
}

function createOptimizeTools(state: OptimizeState): readonly ToolDefinition<JsonValue, string, LlmlintSessionInitial>[] {
    const replace = defineTool<JsonValue, string, LlmlintSessionInitial>({
        name: "replace",
        description: "把正文中一处原文片段替换为改写后的文本。oldText 必须原样摘自当前正文且唯一；一次只改一处。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {
            type: "object",
            properties: {oldText: {type: "string"}, newText: {type: "string"}, reason: {type: "string"}},
            required: ["oldText", "newText"],
            additionalProperties: false,
        }),
        executionMode: "sequential" as const,
        execute(argumentsValue, context) {
            const argumentsObject = asObject(argumentsValue);
            if (state.edits.length >= MAX_EDITS) return {content: `已达到 ${MAX_EDITS} 个成功替换上限，请调用 finish。`, isError: true};
            const oldText = requiredString(argumentsObject.oldText, "oldText");
            const newText = requiredString(argumentsObject.newText, "newText");
            const applied = applyReplace(state.working, oldText, newText);
            if (!applied.ok) return {content: applied.error, isError: true};
            state.working = applied.next;
            const edit: AgentEdit = {
                oldText,
                newText,
                reason: typeof argumentsObject.reason === "string" ? argumentsObject.reason : null,
            };
            state.edits.push(edit);
            const entry: SessionWritePlan<string, LlmlintSessionInitial> = {
                target: context.sessionId,
                expectedVersion: context.snapshot.version,
                cause: "llmlint.optimize.edit",
                operations: [{type: "appendEntries", entries: [{kind: "llmlint.edit", invocationId: context.invocationId, payload: {oldText: edit.oldText, newText: edit.newText, reason: edit.reason}}]}],
            };
            return {content: `已完成第 ${state.edits.length} 处替换。`, writePlans: [entry]};
        },
    });
    const finish = defineTool<JsonValue, string, LlmlintSessionInitial>({
        name: "finish",
        description: "全部修改完成后调用，结束本轮改写。",
        parameters: objectSchema<JsonObject>(value => asObject(value), {
            type: "object",
            properties: {summary: {type: "string"}},
            additionalProperties: false,
        }),
        executionMode: "sequential" as const,
        execute(argumentsValue) {
            const argumentsObject = asObject(argumentsValue);
            state.summary = typeof argumentsObject.summary === "string" ? argumentsObject.summary : "";
            const body = state.selection
                ? state.originalBody.slice(0, state.selection.from) + state.working + state.originalBody.slice(state.selection.to)
                : state.working;
            const output: LlmlintOptimizeResult = {body, edits: state.edits, partial: false, summary: state.summary};
            return {content: "本轮改写已结束。", terminate: true, output};
        },
    });
    return [replace, finish];
}

function parsePayload(value: JsonValue): LlmlintHarnessPayload {
    const object = asObject(value);
    const mode = object.mode === "prompt" || object.mode === "continue" ? object.mode : null;
    const phase = object.phase === "analysis" || object.phase === "optimize" ? object.phase : null;
    if (!mode || !phase) throw new Error("Agent payload.mode/phase 无效");
    const body = requiredString(object.body, "body");
    const parsed: AgentInvokeRequest = {
        mode,
        phase,
        body,
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
        return {
            oldText: requiredString(edit.oldText, `output.edits[${index}].oldText`),
            newText: requiredString(edit.newText, `output.edits[${index}].newText`),
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
    return {
        oldText: requiredString(object.oldText, "edit.oldText"),
        newText: requiredString(object.newText, "edit.newText"),
        reason: typeof object.reason === "string" ? object.reason : null,
    };
}

function parseSelection(value: JsonValue): NonNullable<AgentInvokeRequest["selection"]> {
    const object = asObject(value);
    const from = requiredInteger(object.from, "selection.from");
    const to = requiredInteger(object.to, "selection.to");
    const text = requiredString(object.text, "selection.text");
    if (to <= from) throw new Error("selection.to 必须大于 selection.from");
    return {from, to, text};
}

function applyReplace(working: string, oldText: string, newText: string): {ok: true; next: string} | {ok: false; error: string} {
    if (!oldText) return {ok: false, error: "oldText 为空。请原样摘录一段要修改的正文。"};
    if (oldText === newText) return {ok: false, error: "oldText 与 newText 相同，没有产生修改。请给出真正改写后的文本。"};
    const first = working.indexOf(oldText);
    if (first < 0) return {ok: false, error: "oldText 未在正文中找到。请原样摘录正文片段。"};
    if (working.indexOf(oldText, first + oldText.length) >= 0) return {ok: false, error: "oldText 在正文中命中多处，请扩大摘录范围使其唯一。"};
    return {ok: true, next: working.slice(0, first) + newText + working.slice(first + oldText.length)};
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

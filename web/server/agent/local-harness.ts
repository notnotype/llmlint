import {Type} from "typebox";
import type {AssistantMessage} from "evals-generator/model-client";
import {runAgentLoop, type AgentLoopOptions, type ToolExecution} from "evals-generator/agent-loop";
import type {AssistantMessageEvent} from "@earendil-works/pi-ai";
import {llmRulesPrompt} from "evals-generator/llm-rules-prompt";
import {repairPrompt} from "evals-generator/prompts";
import type {ResolvedModel} from "evals-generator/config";
import type {LLMRuleRecord} from "llmlint/types";
import type {
    AgentEdit,
    AgentInvocationPhase,
    AgentInvocationSnapshot,
    AgentInvokeRequest,
    AgentInvokeResponse,
    AgentSessionEvent,
    AgentSessionSnapshot,
    AgentTimelineEntry,
    LlmAnalysisReport,
    LlmRuleHit,
} from "#shared/agent-harness";
import registryData from "../../app/data/registry.json";
import {prisma} from "../database/prisma";
import {readEvalConfig, resolveChannelModel} from "../utils/eval-channel";
import {scanRevisionBody} from "../utils/scan";
import {applyReplace} from "../utils/llm-fix-agent";
import type {AgentHarnessPort} from "./harness-port";
import {AgentEventBus} from "./event-bus";
import {chunkBody, parseReport, parseRuleHit} from "./analysis-contract";
import {llmRiskScore} from "./llm-risk-score";

const PROFILE_KEY = "llmlint.review" as const;
const ANALYSIS_PROMPT_VERSION = "llm-rules-agent-v4";
const REWRITE_PROMPT_VERSION = "repair-agent-v1";
const MAX_TURNS = 64;
const MAX_EDITS = 64;
const MAX_TOKENS_PER_TURN = 4000;
const CHUNK_VISIBLE_CHARS = 4000;

const registry = registryData as unknown as {llmRules: LLMRuleRecord[]};

const READ_CHUNK_TOOL = {
    name: "read_document_chunk",
    description: "按编号读取一个正文块。必须读取全部块后才能提交报告。",
    parameters: Type.Object({index: Type.Integer({minimum: 0})}, {additionalProperties: false}),
};
const LINT_CONTEXT_TOOL = {
    name: "get_lint_context",
    description: "查询服务器真实 llmlint 扫描统计与本轮 LLM 规则清单。提交报告前必须调用一次。",
    parameters: Type.Object({}, {additionalProperties: false}),
};
const RECORD_HIT_TOOL = {
    name: "record_rule_hit",
    description: "记录一处确定命中的 LLM 规则。quote 必须逐字摘自正文。",
    parameters: Type.Object({
        ruleId: Type.String(),
        quote: Type.String({minLength: 1, maxLength: 120}),
        reason: Type.String({minLength: 1, maxLength: 500}),
    }, {additionalProperties: false}),
};
const REPORT_TOOL = {
    name: "report_result",
    description: "全文检查完成后提交结构化规则审查报告，并结束分析。风险分由服务器计算。",
    parameters: Type.Object({
        confidence: Type.Number({minimum: 0, maximum: 1}),
        conclusion: Type.String({minLength: 1, maxLength: 1000}),
        suggestions: Type.Array(Type.String({minLength: 1, maxLength: 500}), {maxItems: 5}),
    }, {additionalProperties: false}),
};
const REPLACE_TOOL = {
    name: "replace",
    description: "把当前工作正文中一处唯一原文替换为新文本。一次只做一个局部修改。",
    parameters: Type.Object({oldText: Type.String(), newText: Type.String(), reason: Type.Optional(Type.String())}, {additionalProperties: false}),
};
const FINISH_TOOL = {
    name: "finish",
    description: "完成本轮改写后调用。",
    parameters: Type.Object({summary: Type.Optional(Type.String())}, {additionalProperties: false}),
};

type ModelContextPayload = {messages: unknown[]};
type OptimizeResult = {body: string; edits: AgentEdit[]; partial: boolean; summary?: string};

/**
 * Prisma append-only session + Pi agent loop 的本地 Adapter。
 * 产品调用方只通过 AgentHarnessPort 使用它，未来可替换为独立 NeuroAgentHarness Adapter。
 */
export class LocalAgentHarness implements AgentHarnessPort {
    private readonly events = new AgentEventBus();
    private readonly controllers = new Map<string, AbortController>();
    private model: ResolvedModel | null | undefined;

    async createSession(revisionId: string, userId: number): Promise<{sessionId: string}> {
        const session = await prisma.agentSession.upsert({
            where: {revisionId_profileKey: {revisionId, profileKey: PROFILE_KEY}},
            update: {},
            create: {revisionId, userId, profileKey: PROFILE_KEY},
        });
        return {sessionId: session.id};
    }

    async getSnapshot(sessionId: string, userId: number): Promise<AgentSessionSnapshot> {
        const session = await this.ownedSession(sessionId, userId);
        const [entries, invocations, review] = await Promise.all([
            prisma.agentSessionEntry.findMany({where: {sessionId}, orderBy: {createdAt: "asc"}}),
            prisma.agentInvocation.findMany({where: {sessionId}, orderBy: {createdAt: "asc"}}),
            prisma.machineLlmReview.findFirst({where: {sessionId}, orderBy: {judgedAt: "desc"}}),
        ]);
        const mappedInvocations = invocations.map((invocation): AgentInvocationSnapshot => ({
            id: invocation.id,
            mode: invocation.mode as "prompt" | "continue",
            phase: invocation.phase as AgentInvocationPhase,
            status: invocation.status as AgentInvocationSnapshot["status"],
            turns: invocation.turns,
            error: invocation.error,
            createdAt: invocation.createdAt.toISOString(),
            finishedAt: invocation.finishedAt?.toISOString() ?? null,
            input: JSON.parse(invocation.inputJson) as AgentInvokeRequest,
            result: invocation.resultJson ? JSON.parse(invocation.resultJson) as OptimizeResult : null,
        }));
        const activeInvocation = mappedInvocations.findLast((item) => item.status === "running") ?? null;
        return {
            sessionId,
            revisionId: session.revisionId,
            profileKey: PROFILE_KEY,
            status: session.status as AgentSessionSnapshot["status"],
            activeInvocation,
            invocations: mappedInvocations,
            entries: entries.filter((entry) => entry.kind !== "model_context").map((entry) => this.mapEntry(entry)),
            report: review ? JSON.parse(review.reportJson) as LlmAnalysisReport : null,
            hits: review ? JSON.parse(review.hitsJson) as LlmRuleHit[] : [],
            eventCursor: this.events.cursor(sessionId),
        };
    }

    async invoke(sessionId: string, userId: number, request: AgentInvokeRequest): Promise<AgentInvokeResponse> {
        const session = await this.ownedSession(sessionId, userId);
        if (session.status === "running" || session.status === "aborting") {
            throw createError({statusCode: 409, message: "Agent 正在运行，请等待完成或先取消"});
        }
        const invocation = await prisma.agentInvocation.create({
            data: {sessionId, mode: request.mode, phase: request.phase, status: "running", inputJson: JSON.stringify(request)},
        });
        await prisma.agentSession.update({where: {id: sessionId}, data: {status: "running"}});
        await this.appendEntry(sessionId, invocation.id, "lifecycle", {status: "running", phase: request.phase});
        this.events.publish({kind: "session", sessionId, invocationId: invocation.id, event: {type: "status", status: "running", invocationId: invocation.id}});
        this.events.publish({kind: "runtime", sessionId, invocationId: invocation.id, event: {type: "agent_start", phase: request.phase}});
        const controller = new AbortController();
        this.controllers.set(sessionId, controller);
        void this.runInvocation(session.revisionId, invocation.id, request, controller).catch((error) => {
            console.error(`[agent-harness] 未捕获错误 invocation=${invocation.id}：${error instanceof Error ? error.message : String(error)}`);
        });
        return {sessionId, invocationId: invocation.id, status: "accepted"};
    }

    async abort(sessionId: string, userId: number): Promise<{status: "idle" | "aborted"}> {
        const session = await this.ownedSession(sessionId, userId);
        if (session.status !== "running") {
            return {status: "idle"};
        }
        await prisma.agentSession.update({where: {id: sessionId}, data: {status: "aborting"}});
        this.events.publish({kind: "session", sessionId, event: {type: "status", status: "aborting"}});
        this.controllers.get(sessionId)?.abort("user_cancelled");
        return {status: "aborted"};
    }

    async retry(sessionId: string, userId: number): Promise<AgentInvokeResponse> {
        await this.ownedSession(sessionId, userId);
        const latest = await prisma.agentInvocation.findFirst({where: {sessionId}, orderBy: {createdAt: "desc"}});
        if (!latest || !["failed", "aborted", "interrupted"].includes(latest.status)) {
            throw createError({statusCode: 409, message: "当前没有可重试的 Agent invocation"});
        }
        return this.invoke(sessionId, userId, JSON.parse(latest.inputJson) as AgentInvokeRequest);
    }

    subscribeEvents(sessionId: string, cursor: {eventEpoch?: string; after: number}, listener: (event: AgentSessionEvent) => void) {
        return this.events.subscribe(sessionId, cursor, listener);
    }

    /** 服务启动时把无法恢复的运行中 invocation 显式标成 interrupted。 */
    async reconcileInterrupted(): Promise<void> {
        const now = new Date();
        await prisma.agentInvocation.updateMany({where: {status: "running"}, data: {status: "interrupted", error: "服务重启，运行已中断", finishedAt: now}});
        await prisma.agentSession.updateMany({where: {status: {in: ["running", "aborting"]}}, data: {status: "interrupted"}});
    }

    private async runInvocation(revisionId: string, invocationId: string, request: AgentInvokeRequest, controller: AbortController): Promise<void> {
        const invocation = await prisma.agentInvocation.findUniqueOrThrow({where: {id: invocationId}});
        try {
            if (request.phase === "analysis") {
                await this.runAnalysis(revisionId, invocation.sessionId, invocationId, controller.signal);
            } else {
                await this.runOptimize(invocation.sessionId, invocationId, request, controller.signal);
            }
        } catch (error) {
            const aborted = controller.signal.aborted;
            await this.finishInvocation(invocation.sessionId, invocationId, aborted ? "aborted" : "failed", undefined, error instanceof Error ? error.message : String(error));
        } finally {
            this.controllers.delete(invocation.sessionId);
        }
    }

    private async runAnalysis(revisionId: string, sessionId: string, invocationId: string, signal: AbortSignal): Promise<void> {
        const [revision, scan] = await Promise.all([
            prisma.revision.findUniqueOrThrow({where: {id: revisionId}}),
            prisma.machineScan.findFirst({where: {revisionId}, orderBy: {scannedAt: "desc"}}),
        ]);
        const body = revision.body;
        const chunks = chunkBody(body, CHUNK_VISIBLE_CHARS);
        const inspected = new Set<number>();
        let contextQueried = false;
        const hits: LlmRuleHit[] = [];
        const analysisState: {report?: Omit<LlmAnalysisReport, "score">} = {};
        const ruleIds = new Set(registry.llmRules.map((rule) => rule.id));
        const ruleLevels = new Map(registry.llmRules.map((rule) => [rule.id, rule.level] as const));
        const scanStats = scan ? scanRevisionBody(body) : {hits: [], docScore: 0};
        const userText = `请完成本篇文本的 LLM 规则检查并提交报告。正文共 ${chunks.length} 块。先调用 get_lint_context 查询服务器扫描统计与规则，再逐块读取正文。`;
        const messages = await this.messagesForInvocation(sessionId, userText);
        await this.appendEntry(sessionId, invocationId, "user", {text: userText});
        const result = await runAgentLoop(this.resolveModel(), {
            system: llmRulesPrompt(ANALYSIS_PROMPT_VERSION).system,
            user: userText,
            messages,
            tools: [READ_CHUNK_TOOL, LINT_CONTEXT_TOOL, RECORD_HIT_TOOL, REPORT_TOOL],
            maxTurns: MAX_TURNS,
            maxTokensPerTurn: MAX_TOKENS_PER_TURN,
            signal,
            execute: (call): ToolExecution => {
                if (call.name === "read_document_chunk") {
                    const index = call.arguments.index;
                    if (!Number.isInteger(index) || typeof index !== "number" || index < 0 || index >= chunks.length) {
                        return {content: `正文块编号无效，可用范围 0-${Math.max(0, chunks.length - 1)}`, isError: true};
                    }
                    inspected.add(index);
                    const chunk = chunks[index]!;
                    return {content: `正文块 ${index + 1}/${chunks.length}，UTF-16 span=${chunk.start}-${chunk.end}\n${chunk.text}`};
                }
                if (call.name === "get_lint_context") {
                    contextQueried = true;
                    return {content: `服务器真实扫描：regex 命中 ${scanStats.hits.length} 处，docScore=${scanStats.docScore.toFixed(1)}。\nLLM 规则：\n${registry.llmRules.map((rule) => `- ${rule.id}：${rule.title}；${rule.detector.prompt}`).join("\n")}`};
                }
                if (call.name === "record_rule_hit") {
                    const parsed = parseRuleHit(call, body, ruleIds);
                    if (!parsed.ok) {
                        return {content: parsed.error, isError: true};
                    }
                    if (!hits.some((hit) => hit.ruleId === parsed.hit.ruleId && hit.quote === parsed.hit.quote)) {
                        hits.push(parsed.hit);
                    }
                    return {content: `已记录 ${parsed.hit.ruleId}：${parsed.hit.quote}`};
                }
                if (call.name === "report_result") {
                    if (!contextQueried) {
                        return {content: "尚未调用 get_lint_context 查询服务器扫描统计与规则清单，不能提交报告。", isError: true};
                    }
                    if (inspected.size !== chunks.length) {
                        return {content: `尚有 ${chunks.length - inspected.size} 个正文块未检查，不能提交报告。`, isError: true};
                    }
                    const parsed = parseReport(call.arguments, hits);
                    if (!parsed.ok) {
                        return {content: parsed.error, isError: true};
                    }
                    analysisState.report = parsed.report;
                    return {content: "结构化分析报告已接收。", terminate: true};
                }
                return {content: `未知工具：${call.name}`, isError: true};
            },
            onTurn: async (assistant, turn) => {
                await this.appendAssistant(sessionId, invocationId, assistant, turn);
            },
            onToolResult: async (call, execution, turn) => {
                await this.appendEntry(sessionId, invocationId, "tool_result", {toolName: call.name, text: execution.content, message: execution.isError ? "error" : "ok", turns: turn});
            },
            ...this.runtimeCallbacks(sessionId, invocationId),
        });
        const reportDraft = analysisState.report;
        if (!reportDraft) {
            throw new Error(`Agent 在 ${result.turns} 轮内未提交 report_result`);
        }
        const report: LlmAnalysisReport = {...reportDraft, score: llmRiskScore(body, hits, ruleLevels)};
        const modelKey = this.resolveModel().modelKey;
        await prisma.machineLlmReview.create({
            data: {
                revisionId,
                sessionId,
                invocationId,
                model: modelKey,
                promptVersion: ANALYSIS_PROMPT_VERSION,
                score: report.score,
                confidence: report.confidence,
                hitsJson: JSON.stringify(hits),
                reportJson: JSON.stringify(report),
            },
        });
        await this.appendEntry(sessionId, invocationId, "report", {report});
        await this.appendModelContext(sessionId, invocationId, result.messages);
        await this.finishInvocation(sessionId, invocationId, "completed", undefined, undefined, result.turns);
    }

    private async runOptimize(sessionId: string, invocationId: string, request: AgentInvokeRequest, signal: AbortSignal): Promise<void> {
        const instruction = request.message?.trim() || "请优化当前文本，保持原意、人物声音和上下文衔接。";
        const selection = request.selection;
        if (selection && request.body.slice(selection.from, selection.to) !== selection.text) {
            throw new Error("选区已变化，请重新选择后再发送");
        }
        let working = selection ? selection.text : request.body;
        const edits: AgentEdit[] = [];
        let summary = "";
        const userText = selection
            ? `用户要求：${instruction}\n\n仅修改下面选区，不得改动选区外文本：\n${selection.text}`
            : `用户要求：${instruction}\n\n当前真实草稿快照：\n${request.body}`;
        const messages = await this.messagesForInvocation(sessionId, userText);
        await this.appendEntry(sessionId, invocationId, "user", {text: instruction});
        const editsByCall = new Map<string, AgentEdit>();
        let result;
        try {
            result = await runAgentLoop(this.resolveModel(), {
            system: repairPrompt(REWRITE_PROMPT_VERSION).system,
            user: userText,
            messages,
            tools: [REPLACE_TOOL, FINISH_TOOL],
            maxTurns: MAX_TURNS,
            maxTokensPerTurn: MAX_TOKENS_PER_TURN,
            signal,
            execute: (call): ToolExecution => {
                if (call.name === "finish") {
                    summary = typeof call.arguments.summary === "string" ? call.arguments.summary : "";
                    return {content: "本轮改写已结束。", terminate: true};
                }
                if (call.name !== "replace") {
                    return {content: `未知工具：${call.name}`, isError: true};
                }
                if (edits.length >= MAX_EDITS) {
                    return {content: `已达到 ${MAX_EDITS} 个成功替换上限，请调用 finish。`};
                }
                const oldText = call.arguments.oldText;
                const newText = call.arguments.newText;
                if (typeof oldText !== "string" || typeof newText !== "string") {
                    return {content: "replace 的 oldText/newText 必须是字符串", isError: true};
                }
                const applied = applyReplace(working, oldText, newText);
                if (!applied.ok) {
                    return {content: applied.error, isError: true};
                }
                working = applied.next;
                const edit: AgentEdit = {oldText, newText, reason: typeof call.arguments.reason === "string" ? call.arguments.reason : null};
                edits.push(edit);
                editsByCall.set(call.id, edit);
                return {content: `已完成第 ${edits.length} 处替换。`};
            },
            onTurn: async (assistant, turn) => {
                await this.appendAssistant(sessionId, invocationId, assistant, turn);
            },
            onToolResult: async (call, execution, turn) => {
                const edit = editsByCall.get(call.id);
                if (edit) {
                    await this.appendEntry(sessionId, invocationId, "edit", edit);
                }
                await this.appendEntry(sessionId, invocationId, "tool_result", {toolName: call.name, text: execution.content, message: execution.isError ? "error" : "ok", turns: turn});
            },
            ...this.runtimeCallbacks(sessionId, invocationId),
            });
        } catch (error) {
            if (!signal.aborted) {
                throw error;
            }
            const partialBody = selection
                ? request.body.slice(0, selection.from) + working + request.body.slice(selection.to)
                : working;
            await this.finishInvocation(sessionId, invocationId, "aborted", {body: partialBody, edits, partial: true, summary: "用户取消，保留已完成修改"});
            return;
        }
        const body = selection
            ? request.body.slice(0, selection.from) + working + request.body.slice(selection.to)
            : working;
        const output: OptimizeResult = {body, edits, partial: result.stop === "max-turns", summary};
        await this.appendModelContext(sessionId, invocationId, result.messages);
        await this.finishInvocation(sessionId, invocationId, "completed", output, undefined, result.turns);
    }

    private resolveModel(): ResolvedModel {
        if (this.model) {
            return this.model;
        }
        const loaded = readEvalConfig();
        if (!loaded.ok || !loaded.config.repair?.model) {
            throw new Error("LLM Agent 通道未配置");
        }
        this.model = resolveChannelModel(loaded.config, loaded.configPath, loaded.config.repair.model);
        return this.model;
    }

    private async messagesForInvocation(sessionId: string, userText: string): Promise<unknown[]> {
        const context = await prisma.agentSessionEntry.findFirst({where: {sessionId, kind: "model_context"}, orderBy: {createdAt: "desc"}});
        const messages = context ? (JSON.parse(context.payloadJson) as ModelContextPayload).messages : [];
        return [...messages, {role: "user", content: [{type: "text", text: userText}], timestamp: Date.now()}];
    }

    private async appendAssistant(sessionId: string, invocationId: string, assistant: AssistantMessage, turn: number): Promise<void> {
        const text = (assistant.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
        await this.appendEntry(sessionId, invocationId, "assistant", {text: text || `Agent 第 ${turn} 轮完成工具规划`, turns: turn});
    }

    private async appendModelContext(sessionId: string, invocationId: string, messages: unknown[]): Promise<void> {
        await this.appendEntry(sessionId, invocationId, "model_context", {messages});
    }

    private async finishInvocation(sessionId: string, invocationId: string, status: "completed" | "failed" | "aborted", result?: OptimizeResult, error?: string, turns = 0): Promise<void> {
        await prisma.$transaction([
            prisma.agentInvocation.update({where: {id: invocationId}, data: {status, resultJson: result ? JSON.stringify(result) : null, error: error ?? null, turns, finishedAt: new Date()}}),
            prisma.agentSession.update({where: {id: sessionId}, data: {status: status === "completed" || status === "aborted" || status === "failed" ? "idle" : status}}),
        ]);
        await this.appendEntry(sessionId, invocationId, error ? "error" : "lifecycle", {status, message: error, turns});
        this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "agent_end", status}});
        this.events.publish({kind: "session", sessionId, invocationId, event: {type: "status", status: "idle", invocationId}});
    }

    private async appendEntry(sessionId: string, invocationId: string | null, kind: string, payload: object): Promise<void> {
        const session = await prisma.agentSession.findUniqueOrThrow({where: {id: sessionId}, select: {activeLeafId: true}});
        const entry = await prisma.agentSessionEntry.create({data: {sessionId, invocationId, parentId: session.activeLeafId, kind, payloadJson: JSON.stringify(payload)}});
        await prisma.agentSession.update({where: {id: sessionId}, data: {activeLeafId: entry.id}});
        if (kind !== "model_context") {
            this.events.publish({kind: "session", sessionId, invocationId: invocationId ?? undefined, event: {type: "entry", entry: this.mapEntry(entry)}});
        }
    }

    /** 将 Pi 原生流事件和工具生命周期投影到 llmlint 的 NeuroBook 兼容 SSE 子集。 */
    private runtimeCallbacks(sessionId: string, invocationId: string): Pick<AgentLoopOptions, "onTurnStart" | "onMessageEvent" | "onToolStart" | "onToolEnd" | "onTurnEnd"> {
        return {
            onTurnStart: (turn) => {
                this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "turn_start", turn}});
            },
            onMessageEvent: (messageEvent, turn) => {
                this.publishMessageEvent(sessionId, invocationId, turn, messageEvent);
            },
            onToolStart: (call, turn) => {
                this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "tool_execution_start", turn, toolCallId: call.id, toolName: call.name, args: call.arguments}});
            },
            onToolEnd: (call, execution, turn) => {
                this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "tool_execution_end", turn, toolCallId: call.id, toolName: call.name, result: execution.content, isError: execution.isError === true}});
            },
            onTurnEnd: (turn) => {
                this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "turn_end", turn}});
            },
        };
    }

    private publishMessageEvent(sessionId: string, invocationId: string, turn: number, event: AssistantMessageEvent): void {
        if (event.type === "start") {
            this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "message_start", turn, message: event.partial}});
            return;
        }
        if (event.type === "done") {
            this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "message_end", turn, message: event.message}});
            return;
        }
        if (event.type === "error") {
            this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "message_end", turn, message: event.error}});
            return;
        }
        this.events.publish({kind: "runtime", sessionId, invocationId, event: {type: "message_update", turn, message: event.partial, assistantMessageEvent: event}});
    }

    private mapEntry(entry: {id: string; invocationId: string | null; kind: string; payloadJson: string; createdAt: Date}): AgentTimelineEntry {
        return {
            id: entry.id,
            invocationId: entry.invocationId,
            kind: entry.kind as AgentTimelineEntry["kind"],
            payload: JSON.parse(entry.payloadJson) as AgentTimelineEntry["payload"],
            createdAt: entry.createdAt.toISOString(),
        };
    }

    private async ownedSession(sessionId: string, userId: number) {
        const session = await prisma.agentSession.findFirst({where: {id: sessionId, userId}});
        if (!session) {
            throw createError({statusCode: 404, message: "Agent session 不存在"});
        }
        return session;
    }
}

const globalHarness = globalThis as typeof globalThis & {llmlintAgentHarness?: LocalAgentHarness};
export const agentHarness = globalHarness.llmlintAgentHarness ??= new LocalAgentHarness();

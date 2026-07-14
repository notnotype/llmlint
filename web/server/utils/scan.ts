// 服务端机器扫描（Task 13 D-C：机器信号一律服务器计算写入，浏览器扫描只作展示层）。
// 引擎与浏览器同一套：构建期预烘的 registry.json（默认配置 materializeRules 产物）+ 纯函数 scanText。
// docScore 口径对齐 evals/lib/scan.ts：去重 span / 千字，字数 = 去空白码点（visibleCharCount）。
// 与 evals 一致做全文扫描（不做 Markdown 遮罩）——采集正文是小说散文，且要与 evals 基线可比。
import {scanText} from "llmlint/scanner";
import type {Issue, RegexRuleRecord} from "llmlint/types";
import registryData from "../../app/data/registry.json";
import type {CreativeRuleProfile} from "../../shared/rule-profile";
import {compositeScore, ruleFaceScore, type AnalysisStatus, type RevisionAnalysis} from "../../shared/analysis";
import {visibleCharCount} from "./dto";
import {revisionLlmReviewDto, type MachineLlmReviewDto} from "./llm-review";
import {latestMachineDetectRun} from "./detect";
import {prisma} from "../database/prisma";

// registry.json 的 regexRules 就是 build 期 materializeRules(默认配置) 的产物；
// 服务端无用户覆盖，直接消费单源产物，engineVersion 与之同一次构建生成（单源）。
const registry = registryData as unknown as {
    engineVersion: string;
    regexRules: RegexRuleRecord[];
    creativeProfile: CreativeRuleProfile;
};

/** 当前创作 task profile 允许进入 LLM 修复清单的规则；构建期已完成 verdict/overlap 解释。 */
export const repairRuleIds: ReadonlySet<string> = new Set(registry.creativeProfile.includedRuleIds);

/** 落库的单条命中（hitsJson 元素）：span 为 UTF-16 半开区间，与 SpanAnnotation 同坐标系。 */
export type MachineScanHitDto = {
    ruleId: string;
    span: {start: number; end: number};
    level: string;
    review: string;
};

/** 揭示后返回给前端的扫描结果（reveal / machine 端点共用）。 */
export type MachineScanDto = {
    id: string;
    engineVersion: string;
    hits: MachineScanHitDto[];
    docScore: number;
    scannedAt: string;
};

/** 外部检测器结果（W3 接通道；现阶段无人写入，查询恒为空数组）。 */
export type MachineDetectDto = {
    id: string;
    detectorName: string;
    detectorVersion: string;
    chunkChars: number;
    docPAi: number;
    /** 分块最大 P(AI)；检测器未提供时为 null。 */
    maxPAi: number | null;
    chunks: Array<{span: {start: number; end: number}; pAi: number}>;
    checkedAt: string;
};

/**
 * 一个 revision 的全部机器断言（D2：只有揭示后才可返回给客户端）。scan 为最新引擎版本的一条；理论上创建即扫，null 仅作防御。
 * llmReview（Task 17 工单 C）：最新一次 LLM 规则评审；null = 异步未到或通道未配置（前端轮询 machine 端点等它落库）。
 */
export type RevisionMachineDto = {
    scan: MachineScanDto | null;
    detects: MachineDetectDto[];
    llmReview: MachineLlmReviewDto | null;
    analysis: RevisionAnalysis;
};

/**
 * 服务端全文扫描的原始命中（引擎 Issue，含 rule.title/review 与 match 原文）。
 * 供 llm-fix（W4）组「问题清单」用——DTO 化的 hits 只有 ruleId/span，不够组 prompt。
 */
export function scanBodyIssues(body: string): Issue[] {
    return scanText(body, registry.regexRules, {});
}

/**
 * 对给定正文跑一次服务端扫描，产出命中 + docScore + engineVersion。
 * 纯计算，不落库；坐标转换与 app/utils/review-ranges.ts 同口径（UTF-16），
 * docScore 与 evals/lib/scan.ts 的 countDedupSpans 同算法（码点区间合并）。
 */
export function scanRevisionBody(body: string): {engineVersion: string; hits: MachineScanHitDto[]; docScore: number} {
    const issues = scanBodyIssues(body);
    const utf16Starts = utf16LineStarts(body);
    const hits = issues.map((issue) => {
        const start = columnToUtf16Offset(body, utf16Starts, issue.line, issue.column);
        return {
            ruleId: issue.rule.id,
            span: {start, end: start + issue.match.length},
            level: issue.rule.level,
            review: issue.rule.review,
        };
    });
    const charCount = visibleCharCount(body);
    const docScore = charCount > 0 ? (countDedupSpans(body, issues) / charCount) * 1000 : 0;
    return {engineVersion: registry.engineVersion, hits, docScore};
}

/**
 * 为一个刚创建的 revision 同步计算并写入 MachineScan（texts.post 建 rev0 / revisions.post 建 rev_k 后调用）。
 * 结果先算后藏：本函数只落库，响应端绝不回传机器数据（D2 由 revealedAt + machine 端点强制）。
 */
export async function recordMachineScan(revisionId: string, body: string): Promise<void> {
    const result = scanRevisionBody(body);
    await prisma.machineScan.create({
        data: {
            revisionId,
            engineVersion: result.engineVersion,
            hitsJson: JSON.stringify(result.hits),
            docScore: result.docScore,
        },
    });
}

/**
 * 读取一个 revision 的机器断言 DTO：最新一条扫描（引擎升版取最新）+ 全部检测器结果。
 * 仅供 reveal / machine 端点在揭示语义成立后调用；D2 的闸在调用方。
 */
export async function revisionMachineDto(revisionId: string): Promise<RevisionMachineDto> {
    const [scan, detects, llmReview, detectRun, session] = await Promise.all([
        prisma.machineScan.findFirst({where: {revisionId}, orderBy: {scannedAt: "desc"}}),
        prisma.machineDetect.findMany({where: {revisionId}, orderBy: {checkedAt: "asc"}}),
        revisionLlmReviewDto(revisionId),
        latestMachineDetectRun(revisionId),
        prisma.agentSession.findFirst({where: {revisionId, profileKey: "llmlint.review"}, include: {invocations: {orderBy: {createdAt: "desc"}, take: 1}}}),
    ]);
    const rulesScore = scan ? Math.round(ruleFaceScore(scan.docScore)) : undefined;
    const detectorScore = detects.length > 0 ? Math.round(detects.reduce((sum, detect) => sum + detect.docPAi, 0) / detects.length * 100) : undefined;
    const latestInvocation = session?.invocations[0];
    const analysisRunning = (session?.status === "running" || session?.status === "aborting") && latestInvocation?.phase === "analysis";
    const llmScore = analysisRunning ? undefined : llmReview?.score;
    const detectorStatus = detects.length > 0 ? "completed" : detectRunStatus(detectRun?.status, detectRun?.error);
    const llmStatus: AnalysisStatus = llmReview
        ? analysisRunning ? "running" : "completed"
        : session?.status === "running" || session?.status === "aborting"
            ? "running"
            : latestInvocation?.status === "failed"
                ? latestInvocation.error?.includes("通道未配置") ? "unavailable" : "failed"
                : latestInvocation?.status === "aborted"
                    ? "cancelled"
                    : session?.status === "interrupted"
                        ? "interrupted"
                        : "waiting";
    const analysis: RevisionAnalysis = {
        rules: {status: scan ? "completed" : "waiting", score: rulesScore ?? null, error: null},
        detector: {status: detectorStatus, score: detectorScore ?? null, error: detectRun?.error ?? null, runId: detectRun?.id},
        llm: {status: llmStatus, score: llmScore ?? null, error: latestInvocation?.error ?? null, sessionId: session?.id, confidence: llmReview?.confidence ?? null, report: llmReview?.report ?? null},
        composite: compositeScore({rules: rulesScore, detector: detectorScore, llm: llmScore}),
    };
    return {
        llmReview,
        analysis,
        scan: scan === null ? null : {
            id: scan.id,
            engineVersion: scan.engineVersion,
            hits: JSON.parse(scan.hitsJson) as MachineScanHitDto[],
            docScore: scan.docScore,
            scannedAt: scan.scannedAt.toISOString(),
        },
        detects: detects.map((detect) => ({
            id: detect.id,
            detectorName: detect.detectorName,
            detectorVersion: detect.detectorVersion,
            chunkChars: detect.chunkChars,
            docPAi: detect.docPAi,
            maxPAi: detect.maxPAi,
            chunks: JSON.parse(detect.chunksJson) as MachineDetectDto["chunks"],
            checkedAt: detect.checkedAt.toISOString(),
        })),
    };
}

function detectRunStatus(status?: string, error?: string | null): AnalysisStatus {
    if (status === "queued" || status === "running") return "running";
    if (status === "failed") return error?.includes("通道未配置") ? "unavailable" : "failed";
    if (status === "cancelled") return "cancelled";
    if (status === "interrupted") return "interrupted";
    return "waiting";
}

/** 每行在文本中的 UTF-16 起始偏移（含首行 0）；与 app/utils/review-ranges.ts 同实现，服务端不 import 前端源码。 */
function utf16LineStarts(text: string): number[] {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === "\n") {
            starts.push(index + 1);
        }
    }
    return starts;
}

/** 把 scanner 的 1-based 码点 column 反算回 UTF-16 offset（与 app/utils/review-ranges.ts 的 columnToOffset 同口径）。 */
function columnToUtf16Offset(text: string, lineStarts: number[], line: number, column: number): number {
    let index = lineStarts[line - 1] ?? 0;
    for (let step = 1; step < column; step++) {
        const codePoint = text.codePointAt(index);
        index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    }
    return index;
}

/** 文档负担口径：命中的 [start,end) 码点区间合并后的处数（重叠算一处）。与 evals/lib/scan.ts 的 countDedupSpans 同算法。 */
function countDedupSpans(text: string, issues: Issue[]): number {
    if (issues.length === 0) {
        return 0;
    }
    const lineStarts = codepointLineStarts(text);
    const intervals = issues
        .map((issue) => {
            const start = (lineStarts[issue.line - 1] ?? 0) + (issue.column - 1);
            const end = (lineStarts[issue.endLine - 1] ?? 0) + issue.endColumn;
            return [start, Math.max(end, start + 1)] as [number, number];
        })
        .sort((left, right) => left[0] - right[0]);

    let merged = 1;
    let currentEnd = intervals[0]![1];
    for (let i = 1; i < intervals.length; i += 1) {
        const [start, end] = intervals[i]!;
        if (start >= currentEnd) {
            merged += 1;
            currentEnd = end;
        } else if (end > currentEnd) {
            currentEnd = end;
        }
    }
    return merged;
}

/** 每行起点的码点偏移；lineStarts[i] = 第 i+1 行起点的码点下标。与 evals/lib/scan.ts 同实现。 */
function codepointLineStarts(text: string): number[] {
    const starts = [0];
    let codepoint = 0;
    for (const char of text) {
        codepoint += 1;
        if (char === "\n") {
            starts.push(codepoint);
        }
    }
    return starts;
}

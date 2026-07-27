import type {CapabilityProvider} from "@notnotype/neuro-agent-harness";
import type {SemanticRuleRecord} from "llmlint/types";
import registryData from "../../../app/data/registry.json";
import {prisma, type PrismaClient} from "../../database/prisma";
import {chunkBody} from "../analysis-contract";
import type {LlmlintSessionInitial} from "./profile";
import {llmlintAnalysisContext, type LlmlintAnalysisContextLoader} from "./analysis-context";
import {llmReviewStatus, type AnalysisStatus} from "#shared/analysis";
import type {LlmAnalysisReport, LlmRuleHit} from "#shared/agent-harness";
import {llmlintRevisionTextSource, type DetectionHeatmap, type RevisionDetectionRecords, type RevisionTextSource, type RevisionTextSourceResolver} from "./revision-text-workspace";

const CHUNK_VISIBLE_CHARS = 4000;
const registry = registryData as unknown as {semanticRules: SemanticRuleRecord[]};

/** 从当前 revision 读取分析所需正文、扫描统计和 LLM 规则清单。 */
export function createLlmlintAnalysisContextProvider(client: PrismaClient = prisma): CapabilityProvider<"llmlint.analysisContext", LlmlintAnalysisContextLoader, string, LlmlintSessionInitial> {
    return {
        capability: llmlintAnalysisContext,
        open(context) {
            return {
                async load(revisionId) {
                    const target = await ownedSessionRevision(client, context.hostContext.revisionId, revisionId);
                    const [revision, scan] = await Promise.all([
                        client.revision.findUniqueOrThrow({where: {id: target.id}}),
                        client.machineScan.findFirst({where: {revisionId: target.id}, orderBy: {scannedAt: "desc"}}),
                    ]);
                    return {
                        body: revision.body,
                        chunks: chunkBody(revision.body, CHUNK_VISIBLE_CHARS),
                        scanStats: scan ? {hitCount: parseScanHits(scan.hitsJson).length, docScore: scan.docScore} : {hitCount: 0, docScore: 0},
                        ruleIds: new Set(registry.semanticRules.map((rule) => rule.id)),
                        ruleLevels: new Map(registry.semanticRules.map((rule) => [rule.id, rule.level] as const)),
                        rulesText: registry.semanticRules.map((rule) => `- ${rule.id}：${rule.title}；${rule.detector.prompt}`).join("\n"),
                    };
                },
            };
        },
    };
}

/** 为 Profile 提供当前 Text 谱系正文与逐检测器原始热力图。 */
export function createLlmlintRevisionTextSourceProvider(client: PrismaClient = prisma): CapabilityProvider<"llmlint.revisionTextSource", RevisionTextSourceResolver, string, LlmlintSessionInitial> {
    return {
        capability: llmlintRevisionTextSource,
        open(context) {
            return {
                async forRevision(revisionId) {
                    const target = await ownedSessionRevision(client, context.hostContext.revisionId, revisionId);
                    const currentDocument = {revisionId: target.id, ordinal: target.ordinal, body: target.body};
                    return {
                        async current() {
                            return currentDocument;
                        },
                        async revision(selector) {
                            const revision = "ordinal" in selector
                                ? await client.revision.findUnique({where: {textId_ordinal: {textId: target.textId, ordinal: selector.ordinal}}, select: {id: true, ordinal: true, body: true}})
                                : await client.revision.findFirst({where: {id: selector.revisionId, textId: target.textId}, select: {id: true, ordinal: true, body: true}});
                            if (!revision) throw new Error("Revision 不属于当前 Text");
                            return {revisionId: revision.id, ordinal: revision.ordinal, body: revision.body};
                        },
                        async detections(detectionRevisionId) {
                            const revision = await client.revision.findFirst({where: {id: detectionRevisionId, textId: target.textId}, select: {id: true, revealedAt: true}});
                            if (!revision) throw new Error("Revision 不属于当前 Text");
                            if (!revision.revealedAt) throw new Error("Revision 检测记录尚未揭示");
                            const [scan, rows, review, detectRun, invocation] = await Promise.all([
                                client.machineScan.findFirst({where: {revisionId: detectionRevisionId}, orderBy: {scannedAt: "desc"}}),
                                client.machineDetect.findMany({where: {revisionId: detectionRevisionId}, orderBy: [{detectorName: "asc"}, {checkedAt: "asc"}]}),
                                client.machineLlmReview.findFirst({where: {revisionId: detectionRevisionId}, orderBy: {judgedAt: "desc"}}),
                                client.machineDetectRun.findFirst({where: {revisionId: detectionRevisionId}, orderBy: {createdAt: "desc"}}),
                                client.agentInvocation.findFirst({where: {revisionId: detectionRevisionId, phase: "analysis"}, include: {session: {select: {status: true}}}, orderBy: {createdAt: "desc"}}),
                            ]);
                            const result: RevisionDetectionRecords = {
                                status: {
                                    scan: scan ? "completed" : "waiting",
                                    detectors: detectionStatus(rows.length, detectRun?.status, detectRun?.error),
                                    llmReview: llmReviewStatus({reviewExists: review !== null, invocationStatus: invocation?.status, sessionStatus: invocation?.session.status, error: invocation?.error}),
                                },
                                scan: scan ? {engineVersion: scan.engineVersion, docScore: scan.docScore, scannedAt: scan.scannedAt.toISOString(), hits: parseScanHits(scan.hitsJson)} : null,
                                llmReview: review ? {
                                    model: review.model,
                                    promptVersion: review.promptVersion,
                                    score: review.score,
                                    confidence: review.confidence,
                                    hits: JSON.parse(review.hitsJson) as LlmRuleHit[],
                                    report: JSON.parse(review.reportJson) as LlmAnalysisReport,
                                    judgedAt: review.judgedAt.toISOString(),
                                } : null,
                                detectors: rows.map((row): DetectionHeatmap => ({
                                    detectorName: row.detectorName,
                                    detectorVersion: row.detectorVersion,
                                    chunkChars: row.chunkChars,
                                    docPAi: row.docPAi,
                                    maxPAi: row.maxPAi,
                                    checkedAt: row.checkedAt.toISOString(),
                                    chunks: parseHeatmapChunks(row.chunksJson),
                                })),
                            };
                            return result;
                        },
                    } satisfies RevisionTextSource;
                },
            };
        },
    };
}

/** 校验目标 Revision 与 Session 当前 Revision 属于同一 Text。 */
async function ownedSessionRevision(client: PrismaClient, currentRevisionId: string, targetRevisionId: string) {
    const current = await client.revision.findUniqueOrThrow({where: {id: currentRevisionId}, select: {textId: true}});
    const target = await client.revision.findFirst({where: {id: targetRevisionId, textId: current.textId}, select: {id: true, textId: true, ordinal: true, body: true}});
    if (!target) throw new Error("Revision 不属于当前 Text");
    return target;
}

function detectionStatus(count: number, status?: string, error?: string | null): AnalysisStatus {
    if (count > 0) return "completed";
    if (status === "queued" || status === "running") return "running";
    if (status === "failed") return error?.includes("通道未配置") ? "unavailable" : "failed";
    if (status === "cancelled") return "cancelled";
    if (status === "interrupted") return "interrupted";
    return "waiting";
}

function parseScanHits(value: string): NonNullable<RevisionDetectionRecords["scan"]>["hits"] {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
        if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
        const hit = item as {ruleId?: unknown; span?: {start?: unknown; end?: unknown}; level?: unknown; review?: unknown};
        if (typeof hit.ruleId !== "string" || typeof hit.span?.start !== "number" || typeof hit.span.end !== "number" || typeof hit.level !== "string" || typeof hit.review !== "string") return [];
        return [{ruleId: hit.ruleId, span: {start: hit.span.start, end: hit.span.end}, level: hit.level, review: hit.review}];
    });
}

/** Prisma JSON 字段属于外部持久数据，必须在能力 Adapter 内完成运行时校验。 */
function parseHeatmapChunks(value: string): DetectionHeatmap["chunks"] {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): DetectionHeatmap["chunks"] => {
        if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
        const chunk = item as {span?: {start?: unknown; end?: unknown}; pAi?: unknown};
        if (typeof chunk.span?.start !== "number" || typeof chunk.span.end !== "number" || typeof chunk.pAi !== "number") return [];
        return [{span: {start: chunk.span.start, end: chunk.span.end}, pAi: chunk.pAi}];
    });
}

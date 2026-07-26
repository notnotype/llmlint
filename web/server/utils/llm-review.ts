import type {LlmAnalysisReport, LlmRuleHit} from "#shared/agent-harness";
import {agentHarness} from "../agent";
import {prisma} from "../database/prisma";

export type MachineLlmReviewHitDto = LlmRuleHit;

export type MachineLlmReviewDto = {
    id: string;
    sessionId: string;
    invocationId: string;
    model: string;
    promptVersion: string;
    score: number;
    confidence: number;
    hits: MachineLlmReviewHitDto[];
    report: LlmAnalysisReport;
    judgedAt: string;
};

/**
 * 为新 revision 建立持久化分析 session，并异步启动首个 analysis invocation。
 */
export async function startMachineLlmReview(revisionId: string, userId: number): Promise<string> {
    const existing = await prisma.agentInvocation.findFirst({where: {revisionId, phase: "analysis"}, select: {sessionId: true}});
    if (existing) return existing.sessionId;
    const {sessionId} = await agentHarness.createSession(revisionId, userId);
    try {
        await agentHarness.invoke(sessionId, userId, {mode: "prompt", phase: "analysis", revisionId});
    } catch (error) {
        const raced = await prisma.agentInvocation.findFirst({where: {sessionId, revisionId, phase: "analysis"}, select: {id: true}});
        if (!raced) throw error;
    }
    return sessionId;
}

/** 首次揭示新 Revision 时沿父版本推进同一 Session，不创建备用 Session。 */
export async function advanceMachineLlmReview(revisionId: string, parentRevisionId: string, userId: number): Promise<string> {
    const existing = await prisma.agentInvocation.findFirst({where: {revisionId, phase: "analysis"}, select: {sessionId: true}});
    if (existing) return existing.sessionId;
    const parentInvocation = await prisma.agentInvocation.findFirst({
        where: {revisionId: parentRevisionId, phase: "analysis", session: {userId, profileKey: "llmlint.review"}},
        orderBy: {createdAt: "desc"},
        select: {sessionId: true},
    });
    const sessionId = parentInvocation?.sessionId ?? (await prisma.agentSession.findFirst({
        where: {revisionId: parentRevisionId, userId, profileKey: "llmlint.review"},
        select: {id: true},
    }))?.id;
    if (!sessionId) throw new Error(`父 Revision ${parentRevisionId} 缺少可推进的 Agent Session`);
    await agentHarness.advanceRevision(sessionId, userId, revisionId);
    return sessionId;
}

/** 最新一次结构化 LLM Agent 报告。 */
export async function revisionLlmReviewDto(revisionId: string): Promise<MachineLlmReviewDto | null> {
    const review = await prisma.machineLlmReview.findFirst({where: {revisionId}, orderBy: {judgedAt: "desc"}});
    return review ? machineLlmReviewToDto(review) : null;
}

/** Prisma 行到前端 DTO 的单一映射。 */
export function machineLlmReviewToDto(review: {
    id: string;
    sessionId: string;
    invocationId: string;
    model: string;
    promptVersion: string;
    score: number;
    confidence: number;
    hitsJson: string;
    reportJson: string;
    judgedAt: Date;
}): MachineLlmReviewDto {
    return {
        id: review.id,
        sessionId: review.sessionId,
        invocationId: review.invocationId,
        model: review.model,
        promptVersion: review.promptVersion,
        score: review.score,
        confidence: review.confidence,
        hits: JSON.parse(review.hitsJson) as LlmRuleHit[],
        report: JSON.parse(review.reportJson) as LlmAnalysisReport,
        judgedAt: review.judgedAt.toISOString(),
    };
}

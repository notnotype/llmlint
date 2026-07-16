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
export async function startMachineLlmReview(revisionId: string, userId: number, body: string): Promise<string> {
    const {sessionId} = await agentHarness.createSession(revisionId, userId);
    const existing = await prisma.machineLlmReview.findFirst({where: {revisionId}, select: {id: true}});
    if (!existing) {
        await agentHarness.invoke(sessionId, userId, {mode: "prompt", phase: "analysis", body});
    }
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

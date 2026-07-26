import type {LlmAnalysisReport} from "./agent-harness";

export type AnalysisStatus = "waiting" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "unavailable";

export type AnalysisChannel = {
    status: AnalysisStatus;
    score: number | null;
    error: string | null;
    runId?: string;
    sessionId?: string;
};

export type RevisionAnalysis = {
    rules: AnalysisChannel;
    detector: AnalysisChannel;
    llm: AnalysisChannel & {confidence: number | null; report: LlmAnalysisReport | null};
    composite: {score: number | null; complete: boolean; available: Array<"rules" | "detector" | "llm">};
};

/** 以最新 Analysis Invocation 为状态真相；旧 Review 只作为可展示的历史物化结果。 */
export function llmReviewStatus(input: {
    reviewExists: boolean;
    invocationStatus?: string;
    sessionStatus?: string;
    error?: string | null;
}): AnalysisStatus {
    if (input.invocationStatus === "running" || input.invocationStatus === "waiting") return "running";
    if (input.invocationStatus === "failed") return input.error?.includes("通道未配置") ? "unavailable" : "failed";
    if (input.invocationStatus === "aborted") return "cancelled";
    if (input.invocationStatus === "interrupted" || (input.invocationStatus === undefined && input.sessionStatus === "interrupted")) return "interrupted";
    return input.reviewExists ? "completed" : "waiting";
}

export const DOC_SCORE_BASELINE = {humanMedian: 19.5, aiMedian: 25.2} as const;
const SIGMOID_MID = (DOC_SCORE_BASELINE.humanMedian + DOC_SCORE_BASELINE.aiMedian) / 2;
const SIGMOID_HALF_GAP = (DOC_SCORE_BASELINE.aiMedian - DOC_SCORE_BASELINE.humanMedian) / 2;
const WEIGHTS = {rules: 0.30, detector: 0.45, llm: 0.25} as const;

/** docScore 到 0–100 规则面分。 */
export function ruleFaceScore(docScore: number): number {
    return 100 / (1 + Math.exp(-(docScore - SIGMOID_MID) / SIGMOID_HALF_GAP));
}

/** 三路按 30/45/25 加权；缺失通道重新归一并标记部分结果。 */
export function compositeScore(scores: {rules?: number; detector?: number; llm?: number}): {score: number | null; complete: boolean; available: Array<"rules" | "detector" | "llm">} {
    const available = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).filter((key) => scores[key] !== undefined);
    if (available.length === 0) {
        return {score: null, complete: false, available};
    }
    const weight = available.reduce((sum, key) => sum + WEIGHTS[key], 0);
    const raw = available.reduce((sum, key) => sum + scores[key]! * WEIGHTS[key], 0) / weight;
    return {score: Math.round(Math.max(0, Math.min(100, raw))), complete: available.length === 3, available};
}

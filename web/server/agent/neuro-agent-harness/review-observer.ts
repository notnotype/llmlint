import type {JsonObject, JsonValue, SessionCommitNotification, SessionCommitObserver} from "@notnotype/neuro-agent-harness";
import {prisma, type PrismaClient} from "../../database/prisma";
import {parseLlmlintAnalysisResult, type LlmlintAnalysisResult, type LlmlintSessionInitial} from "./profile";

/** 将 durable analysis output 幂等投影到 MachineLlmReview。 */
export class MachineLlmReviewProjector implements SessionCommitObserver<string, LlmlintSessionInitial> {
    readonly name = "llmlint.machineLlmReview";

    constructor(private readonly client: PrismaClient = prisma) {}

    /** commit 后同步投影；失败不会改变 Core 已持久化的事实。 */
    async afterCommit(notification: SessionCommitNotification<string, LlmlintSessionInitial>): Promise<void> {
        for (const invocation of notification.result.snapshot.invocations) {
            if (invocation.status !== "completed" || !isAnalysisInput(invocation.input) || invocation.output === undefined) continue;
            await this.project(
                notification.result.snapshot.metadata.hostContext.revisionId,
                notification.result.snapshot.metadata.sessionId,
                invocation.id,
                parseLlmlintAnalysisResult(invocation.output),
            );
        }
    }

    /** 修复一个 Session 中 observer 遗漏的 completed analysis 投影。 */
    async reconcileSession(sessionId: string): Promise<void> {
        const session = await this.client.agentSession.findUnique({
            where: {id: sessionId},
            select: {
                revisionId: true,
                invocations: {
                    where: {phase: "analysis", status: "completed", resultJson: {not: null}},
                    select: {id: true, resultJson: true},
                    orderBy: {createdAt: "asc"},
                },
            },
        });
        if (!session) return;
        for (const invocation of session.invocations) {
            if (!invocation.resultJson) continue;
            await this.project(session.revisionId, sessionId, invocation.id, parseLlmlintAnalysisResult(parseJson(invocation.resultJson)));
        }
    }

    /** 启动恢复时扫描全部 completed analysis，保证物化视图最终一致。 */
    async reconcileAll(): Promise<void> {
        const sessions = await this.client.agentSession.findMany({
            where: {invocations: {some: {phase: "analysis", status: "completed", resultJson: {not: null}}}},
            select: {id: true},
        });
        for (const session of sessions) await this.reconcileSession(session.id);
    }

    /** 写入单个已验证的 analysis 结果。 */
    private async project(revisionId: string, sessionId: string, invocationId: string, output: LlmlintAnalysisResult): Promise<void> {
        const report = output.report;
        await this.client.machineLlmReview.upsert({
            where: {invocationId},
            create: {
                revisionId,
                sessionId,
                invocationId,
                model: output.model,
                promptVersion: output.promptVersion,
                score: output.score,
                confidence: report.confidence,
                hitsJson: JSON.stringify(output.hits),
                reportJson: JSON.stringify(report),
            },
            update: {
                model: output.model,
                promptVersion: output.promptVersion,
                score: output.score,
                confidence: report.confidence,
                hitsJson: JSON.stringify(output.hits),
                reportJson: JSON.stringify(report),
            },
        });
    }
}

function isAnalysisInput(value: unknown): value is JsonObject {
    return isObject(value) && value.phase === "analysis";
}

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** JSON.parse 是外部持久化边界，先收为 unknown 再交给 Profile validator。 */
function parseJson(raw: string): JsonValue {
    const value: unknown = JSON.parse(raw);
    return value as JsonValue;
}

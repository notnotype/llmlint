import type {CapabilityProvider} from "@notnotype/neuro-agent-harness";
import type {LLMRuleRecord} from "llmlint/types";
import registryData from "../../../app/data/registry.json";
import {prisma, type PrismaClient} from "../../database/prisma";
import {chunkBody} from "../analysis-contract";
import {scanRevisionBody} from "../../utils/scan";
import type {LlmlintSessionInitial} from "./profile";
import {llmlintAnalysisContext, type LlmlintAnalysisContextLoader} from "./analysis-context";

const CHUNK_VISIBLE_CHARS = 4000;
const registry = registryData as unknown as {llmRules: LLMRuleRecord[]};

/** 从当前 revision 读取分析所需正文、扫描统计和 LLM 规则清单。 */
export function createLlmlintAnalysisContextProvider(client: PrismaClient = prisma): CapabilityProvider<"llmlint.analysisContext", LlmlintAnalysisContextLoader, string, LlmlintSessionInitial> {
    return {
        capability: llmlintAnalysisContext,
        open(context) {
            return {
                async load() {
                    const [revision, scan] = await Promise.all([
                        client.revision.findUniqueOrThrow({where: {id: context.hostContext.revisionId}}),
                        client.machineScan.findFirst({where: {revisionId: context.hostContext.revisionId}, orderBy: {scannedAt: "desc"}}),
                    ]);
                    return {
                        body: revision.body,
                        chunks: chunkBody(revision.body, CHUNK_VISIBLE_CHARS),
                        scanStats: scan ? (() => {
                            const stats = scanRevisionBody(revision.body);
                            return {hitCount: stats.hits.length, docScore: stats.docScore};
                        })() : {hitCount: 0, docScore: 0},
                        ruleIds: new Set(registry.llmRules.map((rule) => rule.id)),
                        ruleLevels: new Map(registry.llmRules.map((rule) => [rule.id, rule.level] as const)),
                        rulesText: registry.llmRules.map((rule) => `- ${rule.id}：${rule.title}；${rule.detector.prompt}`).join("\n"),
                    };
                },
            };
        },
    };
}

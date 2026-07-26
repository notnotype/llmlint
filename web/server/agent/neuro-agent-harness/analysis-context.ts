import {defineCapability} from "@notnotype/neuro-agent-harness";

export type LlmlintAnalysisContext = {
    readonly body: string;
    readonly chunks: ReadonlyArray<{start: number; end: number; text: string}>;
    readonly scanStats: {readonly hitCount: number; readonly docScore: number};
    readonly ruleIds: ReadonlySet<string>;
    readonly ruleLevels: ReadonlyMap<string, "high" | "medium" | "low">;
    readonly rulesText: string;
};

export interface LlmlintAnalysisContextLoader {
    /** 加载指定且属于当前 Session Text 的 Revision 分析上下文。 */
    load(revisionId: string): Promise<LlmlintAnalysisContext>;
}

/** Analysis Profile 需要的 invocation-scoped 宿主能力。 */
export const llmlintAnalysisContext = defineCapability<"llmlint.analysisContext", LlmlintAnalysisContextLoader>("llmlint.analysisContext");

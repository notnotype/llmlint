import {NeuroAgentHarness, ProfileRegistry} from "@notnotype/neuro-agent-harness";
import type {AgentHarnessPort} from "./harness-port";
import {NeuroAgentHarnessAdapter} from "./neuro-agent-harness/adapter";
import {LlmlintPiModelRuntime, type LlmlintModelConfig} from "./neuro-agent-harness/pi-runtime";
import {createLlmlintProfile} from "./neuro-agent-harness/profile";
import {PrismaSessionStore, type LlmlintHostContext} from "./neuro-agent-harness/prisma-session-store";
import type {LlmlintSessionInitial} from "./neuro-agent-harness/profile";
import {readEvalConfig, resolveChannelModel} from "../utils/eval-channel";
import {createLlmlintAnalysisContextProvider, createLlmlintRevisionTextSourceProvider} from "./neuro-agent-harness/analysis-capability";
import {MachineLlmReviewProjector} from "./neuro-agent-harness/review-observer";

export interface LlmlintAgentHarness extends AgentHarnessPort {
    reconcileInterrupted(): Promise<void>;
}

const globalHarness = globalThis as typeof globalThis & {llmlintAgentHarness?: LlmlintAgentHarness};

/** llmlint 的唯一 composition root；所有 Session 只由独立 Harness 解释。 */
export const agentHarness: LlmlintAgentHarness = globalHarness.llmlintAgentHarness ??= createHarness();

function createHarness(): LlmlintAgentHarness {
    const store = new PrismaSessionStore();
    const projector = new MachineLlmReviewProjector();
    const loaded = readEvalConfig();
    const repairModelKey = loaded.ok ? loaded.config.repair?.model : undefined;
    const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey, analysisModelKey: repairModelKey}));
    const core = new NeuroAgentHarness<string, LlmlintHostContext, LlmlintModelConfig>({
        store,
        profiles,
        model: new LlmlintPiModelRuntime({resolveModel: resolveLlmlintModel}),
        capabilities: [createLlmlintAnalysisContextProvider(), createLlmlintRevisionTextSourceProvider()],
        commitObservers: [projector],
        onObserverError(observerName, error) {
            console.error(`[agent-harness] observer=${observerName} 投影失败：${error.message}`);
        },
    });
    return new NeuroAgentHarnessAdapter({core, store, projector});
}

function resolveLlmlintModel(modelKey: string) {
    const loaded = readEvalConfig();
    if (!loaded.ok) throw new Error(`LLM Agent 通道配置读取失败：${loaded.error}`);
    return resolveChannelModel(loaded.config, loaded.configPath, modelKey);
}

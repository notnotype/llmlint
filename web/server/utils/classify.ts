// W6：上传后 LLM 异步分类补空（Task 13 D-B 三值三源 / D-E 模型统一 mimo）。
// 运行时直接复用 evals 分类链：classify-agent（report_classification 工具 + 白名单 sanitize）
// + model-client（gate/重试）+ config（modelKey → 连接信息）。配置与 key 一条链：
// evals/eval.config.json 的 classifier.model / modelsConfig → NeuroBook config.json（key 不进本仓任何入 git 文件）。
// 配置读取与模型解析走 eval-channel（W3/W4 抽出的通道公共基建，mini 加载器缘由见该文件头注）。
import {classifyText} from "evals-classifier/classify-agent";
import type {ResolvedModel} from "evals-generator/config";
import {readEvalConfig, resolveChannelModel} from "./eval-channel";
import {prisma} from "../database/prisma";

/** 就绪的分类通道。model=已解析的模型连接信息；maxChars=送入模型的正文截断上限。 */
type ClassifyChannel = {model: ResolvedModel; maxChars: number};

// 通道单例：undefined=尚未初始化；null=初始化失败已禁用（修改 eval 配置后需重启服务生效）。
let channel: ClassifyChannel | null | undefined;

/**
 * 惰性初始化分类通道：读 eval.config.json（路径来自 runtimeConfig.evalConfigPath），
 * 解析 classifier.model 的连接信息，并把重试/限流配置注入 model-client（与 evals CLI 同一套）。
 * 任一环节缺失或失败 → 记一条日志并整体禁用该通道（返回 null），其余流程一切照常。
 */
function resolveChannel(): ClassifyChannel | null {
    if (channel !== undefined) {
        return channel;
    }
    channel = null;
    const loaded = readEvalConfig();
    if (!loaded.ok) {
        console.warn(`[classify] 通道禁用：读不到 eval 配置 ${loaded.configPath}（${loaded.error}）`);
        return channel;
    }
    if (!loaded.config.classifier?.model || !loaded.config.modelsConfig) {
        console.warn(`[classify] 通道禁用：${loaded.configPath} 缺 classifier.model 或 modelsConfig 节`);
        return channel;
    }
    try {
        const model = resolveChannelModel(loaded.config, loaded.configPath, loaded.config.classifier.model);
        channel = {model, maxChars: loaded.config.classifier.maxChars ?? 2000};
        // eval.config.proxy 故意不接：nitro 的 fetch（node/undici）不吃 HTTP(S)_PROXY 环境变量，
        // 分类模型 mimo 是国内服务、已实测可直连；将来必须走代理时按 detect.ts 的 node-fetch-native/proxy 模式补。
        console.info(`[classify] 通道就绪：model=${loaded.config.classifier.model} maxChars=${channel.maxChars}（直连，忽略 eval.config.proxy）`);
    } catch (error) {
        console.warn(`[classify] 通道禁用：分类模型解析失败（${loaded.config.classifier.model}）：${errorMessage(error)}`);
    }
    return channel;
}

/**
 * 上传后异步分类补空：LLM 判 genre/textType/pov，只对当前仍为 null 的字段写值 + 对应 `*Source='llm'`。
 * - 只补空不覆盖（D-B：curator > user > llm）：UPDATE 带「字段 IS NULL」条件在写库瞬间重查，
 *   用户/策展已填的字段绝不触碰（含上传后被并发填值的竞态场景）。
 * - unknown / 白名单外的值已在 classify-agent 的 sanitize 里丢弃（宁缺勿错），对应字段不写。
 * - 任何异常只记日志（含 textId），不重试不上抛；调用方经 event.waitUntil 挂在响应之后，绝不阻塞上传。
 */
export async function backfillTextClassification(textId: string, body: string): Promise<void> {
    const startedAt = Date.now();
    try {
        const active = resolveChannel();
        if (!active) {
            console.info(`[classify] 跳过 textId=${textId}：通道未配置`);
            return;
        }
        const result = await classifyText(body, active.model, active.maxChars);
        // 逐字段落库：updateMany 的 null 条件保证只补空；count=0 说明该字段已被占用（或文本已删）。
        const filled: string[] = [];
        const occupied: string[] = [];
        if (result.genre !== undefined) {
            const written = await prisma.text.updateMany({where: {id: textId, genre: null}, data: {genre: result.genre, genreSource: "llm"}});
            (written.count > 0 ? filled : occupied).push(`genre=${result.genre}`);
        }
        if (result.textType !== undefined) {
            const written = await prisma.text.updateMany({where: {id: textId, textType: null}, data: {textType: result.textType, textTypeSource: "llm"}});
            (written.count > 0 ? filled : occupied).push(`textType=${result.textType}`);
        }
        if (result.pov !== undefined) {
            const written = await prisma.text.updateMany({where: {id: textId, pov: null}, data: {pov: result.pov, povSource: "llm"}});
            (written.count > 0 ? filled : occupied).push(`pov=${result.pov}`);
        }
        const unsure = (["genre", "textType", "pov"] as const).filter((field) => result[field] === undefined);
        console.info(`[classify] 完成 textId=${textId} 耗时=${Date.now() - startedAt}ms 补空=[${filled.join(" ")}] 已占用=[${occupied.join(" ")}] 模型不确定=[${unsure.join(" ")}]`);
    } catch (error) {
        console.warn(`[classify] 失败 textId=${textId} 耗时=${Date.now() - startedAt}ms：${errorMessage(error)}`);
    }
}

/** 错误 → 可读消息（分类通道日志专用，本模块不上抛任何异常）。 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

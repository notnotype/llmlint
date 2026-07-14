// LLM 文本分类小 agent：单轮 + 强制工具调用（照 NeuroBook report_result 模式——
// 工具即结构化出口，参数用 typebox schema 约束枚举白名单）。
// 纪律：拿不准选 "unknown" → 该字段留空（宁缺勿错：错值会污染 byGenre 分层与 task profile 切片）。
import {Type} from "typebox";
import {callModelForTool, type AnyModel} from "../generator/model-client";
import {GENRES, TEXT_TYPES, POVS, inTaxonomy, type TaxonomyEntry} from "../lib/taxonomy";

/** 分类结果：字段缺省 = 模型不确定（unknown）或值非法被丢弃。 */
export type Classification = {genre?: string; textType?: string; pov?: string};

const UNKNOWN = "unknown";

/** 值集 → typebox 枚举（白名单 + unknown）。 */
function taxonomyEnum(entries: TaxonomyEntry[], description: string) {
    return Type.Union([...entries.map((e) => Type.Literal(e.key)), Type.Literal(UNKNOWN)], {description});
}

// report_classification 工具：模型必须调它返回结构化分类（不接受散文回答）。
const REPORT_CLASSIFICATION_TOOL = {
    name: "report_classification",
    description: "报告文本分类结果。三个字段都必填；对某一项没有把握时该项填 \"unknown\"，不要猜。",
    parameters: Type.Object({
        genre: taxonomyEnum(GENRES, `题材。可选值：${GENRES.map((g) => `${g.key}(${g.label})`).join("、")}；不确定填 unknown。`),
        textType: taxonomyEnum(TEXT_TYPES, `体裁。可选值：${TEXT_TYPES.map((t) => `${t.key}(${t.label})`).join("、")}；不确定填 unknown。`),
        pov: taxonomyEnum(POVS, `叙述视角。可选值：${POVS.map((p) => `${p.key}(${p.label})`).join("、")}；不确定填 unknown。`),
    }, {additionalProperties: false}),
};

// 分类 prompt：自包含（不假定调用方上下文），只做分类不做评价。
const CLASSIFY_SYSTEM = `你是中文文本分类助手。读一段正文节选，判断它的题材、体裁和叙述视角，然后调用 report_classification 工具报告结果。

要求：
- 只依据节选内容判断，不臆测节选之外的信息。
- 三个字段只能从工具参数列出的白名单里选；对某一项没有把握就填 "unknown"，绝不要猜一个看似接近的值。
- 不要输出任何正文回答，直接调用工具。`;

/**
 * 对一段正文做 LLM 分类。
 * @param text 正文（内部截断到 maxChars，分类不需要全文）
 * @param model 分类模型（须 HTTP 通道，CLI 无工具协议）
 * @param maxChars 送入模型的正文上限
 * @returns 各字段：白名单内的确定值；unknown / 非法值 → 字段缺省（留空）
 */
export async function classifyText(text: string, model: AnyModel, maxChars = 2000): Promise<Classification> {
    const excerpt = text.slice(0, maxChars);
    const {toolArguments} = await callModelForTool(model, CLASSIFY_SYSTEM, `【正文节选】\n${excerpt}`, REPORT_CLASSIFICATION_TOOL);
    return sanitizeClassification(toolArguments);
}

/** 白名单校验（纯函数，可单测）：unknown → 留空；白名单外的值 → 丢弃 + 告警（宁缺勿错）。 */
export function sanitizeClassification(args: Record<string, unknown>): Classification {
    const result: Classification = {};
    const pick = (field: string, entries: TaxonomyEntry[]): string | undefined => {
        const value = args[field];
        if (typeof value !== "string" || value === UNKNOWN) {
            return undefined;
        }
        if (!inTaxonomy(entries, value)) {
            console.warn(`  ⚠ 分类字段 ${field} 返回白名单外的值「${value}」，丢弃`);
            return undefined;
        }
        return value;
    };
    const genre = pick("genre", GENRES);
    const textType = pick("textType", TEXT_TYPES);
    const pov = pick("pov", POVS);
    if (genre) {
        result.genre = genre;
    }
    if (textType) {
        result.textType = textType;
    }
    if (pov) {
        result.pov = pov;
    }
    return result;
}

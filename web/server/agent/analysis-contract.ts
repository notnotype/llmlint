import type {LlmAnalysisReport, LlmRuleHit} from "../../shared/agent-harness";

type AgentToolCall = {id: string; name: string; arguments: Record<string, unknown>};

/** 按可见字数切正文，span 使用 JS UTF-16 坐标。 */
export function chunkBody(body: string, maxVisible: number): Array<{start: number; end: number; text: string}> {
    const chunks: Array<{start: number; end: number; text: string}> = [];
    let start = 0;
    let cursor = 0;
    let visible = 0;
    for (const char of body) {
        cursor += char.length;
        if (!/\s/u.test(char)) visible += 1;
        if (visible >= maxVisible) {
            chunks.push({start, end: cursor, text: body.slice(start, cursor)});
            start = cursor;
            visible = 0;
        }
    }
    if (start < body.length || chunks.length === 0) chunks.push({start, end: body.length, text: body.slice(start)});
    return chunks;
}

/** 校验并回定位一条 LLM 规则命中。 */
export function parseRuleHit(call: AgentToolCall, body: string, ruleIds: Set<string>): {ok: true; hit: LlmRuleHit} | {ok: false; error: string} {
    const {ruleId, quote, reason} = call.arguments;
    if (typeof ruleId !== "string" || !ruleIds.has(ruleId)) return {ok: false, error: "ruleId 不在 LLM 规则清单中"};
    if (typeof quote !== "string" || quote.length === 0 || quote.length > 120 || typeof reason !== "string" || reason.length === 0) return {ok: false, error: "quote/reason 形状不合法"};
    const start = body.indexOf(quote);
    if (start < 0) return {ok: false, error: "quote 未在正文中逐字找到，请重新摘录"};
    return {ok: true, hit: {ruleId, quote, reason, span: {start, end: start + quote.length}}};
}

/**
 * 校验 report_result，并由服务器从已验收命中生成证据。
 *
 * Agent 不重复提交 quote/ruleId/reason：这些字段已经由 record_rule_hit 校验过，
 * 再抄一次只会给小模型制造无意义的结构化失败点。
 */
export function parseReport(args: Record<string, unknown>, hits: LlmRuleHit[]): {ok: true; report: Omit<LlmAnalysisReport, "score">} | {ok: false; error: string} {
    const {confidence, conclusion, suggestions} = args;
    if (typeof confidence !== "number" || confidence < 0 || confidence > 1 || typeof conclusion !== "string" || conclusion.length === 0) return {ok: false, error: "confidence/conclusion 不合法"};
    if (!Array.isArray(suggestions) || suggestions.length > 5) return {ok: false, error: "suggestions 数量不合法"};
    if (!suggestions.every((item) => typeof item === "string" && item.length > 0)) return {ok: false, error: "suggestions 必须是非空字符串数组"};
    if (hits.length === 0 && suggestions.length > 0) return {ok: false, error: "没有记录规则命中时，suggestions 必须为空数组"};
    const evidence = hits.slice(0, 8).map((hit) => ({quote: hit.quote, reason: hit.reason, ruleIds: [hit.ruleId]}));
    return {ok: true, report: {confidence, conclusion, evidence, suggestions: suggestions as string[]}};
}

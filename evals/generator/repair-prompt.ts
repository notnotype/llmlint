// repair 输入的纯组装逻辑：llmlint 命中 → 按规则聚合的「问题清单」→ user 消息。
// 与 CLI（repair.ts）分离以便单测（CLI 文件顶层 parseAsync，被 import 会直接执行）。
// 长度纪律：清单三层封顶（规则数 / 每规则引文数 / 引文长度），防长章命中爆炸把 prompt 撑爆。

/** collectRepairFindings 只依赖 Issue 的这几个字段（结构子类型：skill 引擎的 Issue 天然满足，测试可直接构造）。 */
export type FindingSource = {rule: {id: string; title: string; review: string}; match: string};

/** 一条聚合后的问题：规则标题 + 原文引文样例。count = 该规则原始命中处数；excerpts 去重/截断/封顶后可能少于 count。 */
export type RepairFinding = {ruleId: string; title: string; count: number; excerpts: string[]};

/** 问题清单的长度封顶（控 prompt 总长）。 */
export type FindingLimits = {maxRules: number; excerptsPerRule: number; excerptChars: number};

export const DEFAULT_FINDING_LIMITS: FindingLimits = {maxRules: 25, excerptsPerRule: 3, excerptChars: 40};

/**
 * 聚合命中为问题清单：只取 review==="agent" 桶（human/none 桶是作者偏好/机械诊断，不该驱动改写）；
 * 按规则聚合、按命中数降序（同数按 ruleId 稳定排序）；同规则引文去重 + 截断 + 封顶条数；规则数封顶。
 */
export function collectRepairFindings(issues: FindingSource[], limits: FindingLimits = DEFAULT_FINDING_LIMITS, eligibleRuleIds?: ReadonlySet<string>): RepairFinding[] {
    const byRule = new Map<string, RepairFinding & {seen: Set<string>}>();
    for (const issue of issues) {
        if (issue.rule.review !== "agent" || (eligibleRuleIds !== undefined && !eligibleRuleIds.has(issue.rule.id))) {
            continue;
        }
        let bucket = byRule.get(issue.rule.id);
        if (!bucket) {
            bucket = {ruleId: issue.rule.id, title: issue.rule.title, count: 0, excerpts: [], seen: new Set()};
            byRule.set(issue.rule.id, bucket);
        }
        bucket.count += 1;
        // 引文：压掉换行/连续空白再截断，同句只展示一次（"去重命中"的展示口径）。
        const excerpt = truncateChars(issue.match.trim().replace(/\s+/gu, " "), limits.excerptChars);
        if (excerpt.length > 0 && !bucket.seen.has(excerpt) && bucket.excerpts.length < limits.excerptsPerRule) {
            bucket.seen.add(excerpt);
            bucket.excerpts.push(excerpt);
        }
    }
    return [...byRule.values()]
        .sort((left, right) => right.count - left.count || left.ruleId.localeCompare(right.ruleId))
        .slice(0, limits.maxRules)
        .map(({ruleId, title, count, excerpts}) => ({ruleId, title, count, excerpts}));
}

/** 一条用户标注（repair-v2 的「用户标注」节）：quote=被批注的原文片段，note=批注内容。 */
export type RepairComment = {quote: string; note: string};

/** 标注引文的长度封顶（码点）：超出截断加省略号，控 prompt 长度（与问题清单引文同思路）。 */
export const COMMENT_QUOTE_CHARS = 120;

/**
 * 组 repair 的 user 消息：正文 + 编号问题清单（+ 可选的「用户标注」节，repair-v2）。
 * comments 缺省/为空时不输出标注节，渲染与 repair-v1 逐字节等价——既有两参调用（线 A repair.ts）行为不变。
 * 标注引文压掉换行/连续空白并按码点截断（超 {@link COMMENT_QUOTE_CHARS} 加省略号）；批注内容同样压成单行保列表结构。
 * closing 可覆盖收尾指令（Task 18 agent 模式用「用工具逐处修改」替代「直接输出完整正文」；缺省渲染逐字节不变）。
 * 措辞自包含，不携带本项目内部术语。
 */
export function buildRepairUser(text: string, findings: RepairFinding[], comments: RepairComment[] = [], closing?: string): string {
    const lines = findings.map((finding, i) => {
        const samples = finding.excerpts.length > 0 ? `：如${finding.excerpts.map((e) => `「${e}」`).join("、")}` : "";
        return `${i + 1}. ${finding.title}（${finding.count} 处）${samples}`;
    });
    const sections = [`【正文】\n${text.trim()}`, `【问题清单】\n${lines.join("\n")}`];
    if (comments.length > 0) {
        const items = comments.map((comment, i) => {
            const quote = truncateChars(comment.quote.trim().replace(/\s+/gu, " "), COMMENT_QUOTE_CHARS);
            return `${i + 1}. 原文「${quote}」——${comment.note.trim().replace(/\s+/gu, " ")}`;
        });
        sections.push(`【用户标注（哪里没改好）】\n${items.join("\n")}`);
    }
    const defaultClosing = comments.length > 0
        ? "请只修复问题清单和用户标注里指出的问题，直接输出润色后的完整正文。"
        : "请只修复问题清单里列出的问题，直接输出润色后的完整正文。";
    return `${sections.join("\n\n")}\n\n${closing ?? defaultClosing}`;
}

/** 按码点截断（中文安全），超长补省略号。 */
function truncateChars(value: string, max: number): string {
    const chars = [...value];
    return chars.length <= max ? value : `${chars.slice(0, max).join("")}…`;
}

/** 选区改写（repair-selection-v1）的输入束：selection=选中文本原样；contextBefore/After=前后文窗（可为空串，文档首尾）；comments=与选区范围相关的用户批注（可缺省）；closing 可覆盖收尾指令（Task 18 agent 模式；缺省渲染不变）。 */
export type RepairSelectionInput = {selection: string; contextBefore: string; contextAfter: string; comments?: RepairComment[]; closing?: string};

/**
 * 组选区改写的 user 消息（Task 13 W7 F2；结构沿 Task 07 已定的选区优化指令）：
 * `## 选中文本`（围栏原样给出，改写对象）→ `## 选区上下文`（前文+【选中文本】+后文重组成连续原文窗，
 * 两窗皆空则整节省略）→ `## 相关用户批注`（有才出节；渲染与 repair-v2 标注节同款：引文压空白 +
 * 码点截断，批注压成单行）→ 收尾指令「只返回改写后的选中文本，不要输出其他内容」。
 * **不组命中清单**（Task 07 契约：改写目标由用户框选指定，清单会把模型注意力拉去改别处）。
 */
export function buildRepairSelectionUser(input: RepairSelectionInput): string {
    const comments = input.comments ?? [];
    const selectionFence = codeFence(input.selection);
    const lines: string[] = ["## 选中文本", "", selectionFence, input.selection, selectionFence];
    if (input.contextBefore.length > 0 || input.contextAfter.length > 0) {
        // 上下文窗按原文顺序重组（before+selection+after 即草稿的连续切片），选中文本用【】标出：
        // 模型只需理解语境，不改写窗内其余文字（【】只是定位提示，正文偶含【】不影响改写对象的判定）。
        const contextText = `${input.contextBefore}【${input.selection}】${input.contextAfter}`;
        const contextFence = codeFence(contextText);
        lines.push("", "## 选区上下文", "", "（【】内是选中文本，上下文只供理解语境，不要改写）", "", contextFence, contextText, contextFence);
    }
    if (comments.length > 0) {
        lines.push("", "## 相关用户批注", "");
        comments.forEach((comment, i) => {
            const quote = truncateChars(comment.quote.trim().replace(/\s+/gu, " "), COMMENT_QUOTE_CHARS);
            lines.push(`${i + 1}. 原文「${quote}」——${comment.note.trim().replace(/\s+/gu, " ")}`);
        });
    }
    lines.push("", input.closing ?? "只返回改写后的选中文本，不要输出其他内容。");
    return lines.join("\n");
}

/** 选一条比文本内最长反引号串更长的围栏（Task 07 markdownFence 同算法），防选区内容破坏围栏结构。 */
function codeFence(text: string): string {
    const matches = text.match(/`+/g) ?? [];
    const longest = matches.reduce((max, item) => Math.max(max, item.length), 2);
    return "`".repeat(longest + 1);
}

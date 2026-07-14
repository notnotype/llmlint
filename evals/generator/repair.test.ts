// repair 纯逻辑守门（bun:test，仿 hardening.test.ts）：问题清单聚合（agent 桶过滤 / 按规则聚合排序 /
// 引文去重截断 / 三层封顶）+ user 消息组装。CLI 编排（repair.ts）不在此测。
import {test, expect} from "bun:test";
import {collectRepairFindings, buildRepairUser, buildRepairSelectionUser, DEFAULT_FINDING_LIMITS, COMMENT_QUOTE_CHARS, type FindingSource} from "./repair-prompt";

function hit(ruleId: string, title: string, review: string, match: string): FindingSource {
    return {rule: {id: ruleId, title, review}, match};
}

test("collectRepairFindings：只收 agent 桶，按规则聚合并按命中数降序", () => {
    const findings = collectRepairFindings([
        hit("r.b", "B 问题", "agent", "乙一"),
        hit("r.a", "A 问题", "agent", "甲一"),
        hit("r.a", "A 问题", "agent", "甲二"),
        hit("r.h", "作者偏好", "human", "丙"),
        hit("r.n", "机械诊断", "none", "丁"),
    ]);
    expect(findings.map((finding) => finding.ruleId)).toEqual(["r.a", "r.b"]); // human/none 桶不进清单
    expect(findings[0]!.count).toBe(2);
    expect(findings[0]!.excerpts).toEqual(["甲一", "甲二"]);
});

test("collectRepairFindings：同规则引文去重，超出每规则上限只计数不再收引文", () => {
    const issues = ["同句", "同句", "一", "二", "三", "四"].map((match) => hit("r", "重复词", "agent", match));
    const [finding] = collectRepairFindings(issues);
    expect(finding!.count).toBe(6); // count = 原始命中处数
    expect(finding!.excerpts).toEqual(["同句", "一", "二"]); // 去重 + excerptsPerRule=3 封顶
});

test("collectRepairFindings：引文按码点截断、规则数封顶（控 prompt 长度）", () => {
    const long = collectRepairFindings([hit("r.long", "长句", "agent", "字".repeat(80))]);
    expect(long[0]!.excerpts[0]).toBe(`${"字".repeat(DEFAULT_FINDING_LIMITS.excerptChars)}…`);
    const many = Array.from({length: DEFAULT_FINDING_LIMITS.maxRules + 5}, (_, i) => hit(`r.${String(i).padStart(2, "0")}`, `问题${i}`, "agent", `例${i}`));
    expect(collectRepairFindings(many)).toHaveLength(DEFAULT_FINDING_LIMITS.maxRules);
});

test("collectRepairFindings：引文压掉换行与连续空白（清单单行可读）", () => {
    const [finding] = collectRepairFindings([hit("r", "跨行", "agent", "上句\n  下句")]);
    expect(finding!.excerpts).toEqual(["上句 下句"]);
});

test("collectRepairFindings：任务 profile 可排除 noise 规则，但保留未测规则", () => {
    const findings = collectRepairFindings([
        hit("r.strong", "强规则", "agent", "强命中"),
        hit("r.noise", "噪声规则", "agent", "噪声命中"),
        hit("r.unmeasured", "未测规则", "agent", "未测命中"),
    ], DEFAULT_FINDING_LIMITS, new Set(["r.strong", "r.unmeasured"]));

    expect(findings.map((finding) => finding.ruleId)).toEqual(["r.strong", "r.unmeasured"]);
});

test("buildRepairUser：正文 + 编号问题清单 + 收尾指令", () => {
    const user = buildRepairUser("正文内容\n", [
        {ruleId: "r1", title: "不是而是", count: 2, excerpts: ["不是A而是B", "不是C而是D"]},
        {ruleId: "r2", title: "眼中闪过", count: 1, excerpts: ["眼中闪过一丝寒意"]},
    ]);
    expect(user).toContain("【正文】\n正文内容");
    expect(user).toContain("1. 不是而是（2 处）：如「不是A而是B」、「不是C而是D」");
    expect(user).toContain("2. 眼中闪过（1 处）：如「眼中闪过一丝寒意」");
    expect(user.endsWith("请只修复问题清单里列出的问题，直接输出润色后的完整正文。")).toBe(true);
});

// —— repair-selection-v1（Task 13 W7 F2）：选区改写的 user 消息（Task 07 选区指令结构） ——

test("buildRepairSelectionUser：选中文本 + 上下文窗（【】标位）+ 收尾指令，不组命中清单", () => {
    const user = buildRepairSelectionUser({selection: "待改写片段", contextBefore: "前文。", contextAfter: "后文。"});
    expect(user).toContain("## 选中文本");
    expect(user).toContain("```\n待改写片段\n```");
    expect(user).toContain("## 选区上下文");
    expect(user).toContain("前文。【待改写片段】后文。");
    expect(user).not.toContain("问题清单"); // 选区模式不组命中清单（Task 07 契约：目标由用户指定）
    expect(user).not.toContain("## 相关用户批注"); // 无批注不出节
    expect(user.endsWith("只返回改写后的选中文本，不要输出其他内容。")).toBe(true);
});

test("buildRepairSelectionUser：批注节有才出、引文压空白并按码点截断；上下文两窗皆空整节省略", () => {
    const withComments = buildRepairSelectionUser({
        selection: "片段",
        contextBefore: "",
        contextAfter: "",
        comments: [{quote: `上句\n  ${"字".repeat(200)}`, note: "太机械了\n请口语化"}],
    });
    expect(withComments).toContain("## 相关用户批注");
    expect(withComments).toContain(`1. 原文「${truncatedQuote(`上句 ${"字".repeat(200)}`)}」——太机械了 请口语化`);
    expect(withComments).not.toContain("## 选区上下文"); // 两窗皆空（整篇即选区）不出上下文节
});

/** 与 buildRepairSelectionUser 同口径的引文截断预期值（码点截断 + 省略号）。 */
function truncatedQuote(value: string): string {
    const chars = [...value];
    return chars.length <= COMMENT_QUOTE_CHARS ? value : `${chars.slice(0, COMMENT_QUOTE_CHARS).join("")}…`;
}

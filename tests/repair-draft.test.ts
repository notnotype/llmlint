import {describe, it, expect} from "vitest";
import {
    createPlan,
    foldDraft,
    deriveDiffs,
    applySourceEdit,
    applyDraftSplice,
    removeEdit,
    clearEdits,
    locateMinimalSplice,
    sourceToDraft,
    draftToSource,
    annotationAnchorFromDraft,
    projectAnnotation,
    projectAnnotations,
    classifyTransitionKind,
    projectHeatChunks,
    type RepairAnnotation,
    type RepairEditKind,
    type RepairPlan,
} from "../web/app/utils/repair-draft";

// repair-draft 是分层派生编辑模型的纯核心（piece-table）。这里用「splice 后的草稿必须等于
// 在旧草稿上直接做同样字符串替换」这一核心不变量做主断言，另覆盖合并 / 溯源 / 边界映射。

const meta = (id: string, kind: RepairEditKind = "user", ruleId?: string) => ({id, kind, title: id, ruleId});

/** 断言核心不变量并返回新计划：foldDraft(splice(plan)) === 旧草稿的直接字符串替换。 */
function spliceAndCheck(plan: RepairPlan, from: number, to: number, text: string, id = "x"): RepairPlan {
    const before = foldDraft(plan);
    const next = applyDraftSplice(plan, from, to, text, meta(id));
    expect(foldDraft(next)).toBe(before.slice(0, from) + text + before.slice(to));
    return next;
}

describe("repair-draft piece-table", () => {
    it("空计划：draft === 原文，无 diff", () => {
        const plan = createPlan("hello world");
        expect(foldDraft(plan)).toBe("hello world");
        expect(deriveDiffs(plan)).toEqual([]);
    });

    it("单条源锚定编辑：fold + 派生 diff 正确", () => {
        const plan = applySourceEdit(createPlan("the quick brown fox"), 4, 9, "slow", meta("e1"));
        expect(foldDraft(plan)).toBe("the slow brown fox");
        const diffs = deriveDiffs(plan);
        expect(diffs).toHaveLength(1);
        expect(diffs[0]).toMatchObject({id: "e1", from: 4, to: 8, deleted: "quick", inserted: "slow", kind: "user"});
    });

    it("两条不重叠编辑：与应用顺序无关，且按源位置排序", () => {
        let plan = createPlan("a b c d");
        plan = applySourceEdit(plan, 6, 7, "D", meta("e2"));
        plan = applySourceEdit(plan, 2, 3, "B", meta("e1"));
        expect(foldDraft(plan)).toBe("a B c D");
        expect(plan.edits.map((edit) => edit.id)).toEqual(["e1", "e2"]);
    });

    it("在未改动区域做 draft splice：锚定到正确的原文区间", () => {
        let plan = applySourceEdit(createPlan("a b c"), 2, 3, "BB", meta("e1"));
        expect(foldDraft(plan)).toBe("a BB c");
        plan = spliceAndCheck(plan, 5, 6, "CC", "e2");
        expect(foldDraft(plan)).toBe("a BB CC");
        expect(plan.edits.find((edit) => edit.id === "e2")).toMatchObject({sourceFrom: 4, sourceTo: 5, replacement: "CC"});
    });

    it("合并：改到「已改过区域」会吸收原编辑成单条，最新来源胜出", () => {
        let plan = applySourceEdit(createPlan("hello"), 0, 5, "WORLD", meta("e1", "static", "r1"));
        expect(foldDraft(plan)).toBe("WORLD");
        plan = applyDraftSplice(plan, 0, 3, "xy", meta("e2", "user"));
        expect(foldDraft(plan)).toBe("xyLD");
        expect(plan.edits).toHaveLength(1);
        expect(plan.edits[0]).toMatchObject({id: "e2", sourceFrom: 0, sourceTo: 5, replacement: "xyLD", kind: "user"});
    });

    it("splice 把内容改回原文 → 该编辑消失", () => {
        let plan = applySourceEdit(createPlan("cat"), 0, 3, "dog", meta("e1"));
        plan = applyDraftSplice(plan, 0, 3, "cat", meta("e2"));
        expect(foldDraft(plan)).toBe("cat");
        expect(plan.edits).toEqual([]);
    });

    it("纯插入（from === to）", () => {
        const plan = spliceAndCheck(createPlan("abc"), 1, 1, "XY", "ins");
        expect(foldDraft(plan)).toBe("aXYbc");
        expect(plan.edits[0]).toMatchObject({sourceFrom: 1, sourceTo: 1, replacement: "XY"});
    });

    it("整篇替换（bulk）", () => {
        let plan = createPlan("old text here");
        plan = spliceAndCheck(plan, 0, plan.source.length, "brand new", "bulk");
        expect(foldDraft(plan)).toBe("brand new");
        expect(plan.edits).toHaveLength(1);
        expect(plan.edits[0]).toMatchObject({sourceFrom: 0, sourceTo: 13});
    });

    it("removeEdit / clearEdits 让对应处回到原文", () => {
        let plan = createPlan("a b c");
        plan = applySourceEdit(plan, 0, 1, "A", meta("e1"));
        plan = applySourceEdit(plan, 4, 5, "C", meta("e2"));
        expect(foldDraft(plan)).toBe("A b C");
        expect(foldDraft(removeEdit(plan, "e1"))).toBe("a b C");
        expect(foldDraft(clearEdits(plan))).toBe("a b c");
    });

    it("坐标映射：sourceToDraft 在边界处精确，draftToSource 在段内部精确", () => {
        const plan = applySourceEdit(createPlan("abcdef"), 2, 4, "XYZ", meta("e1"));
        expect(foldDraft(plan)).toBe("abXYZef");
        expect([0, 2, 4, 6].map((pos) => sourceToDraft(plan, pos))).toEqual([0, 2, 5, 7]);
        expect([0, 1, 6, 7].map((pos) => draftToSource(plan, pos))).toEqual([0, 1, 5, 6]);
    });

    it("连续多次编辑：不变量始终成立、溯源保留", () => {
        let plan = createPlan("The AI wrote a very long sentence here.");
        plan = spliceAndCheck(plan, 4, 6, "model", "a");                       // AI → model
        plan = spliceAndCheck(plan, 0, 3, "An", "b");                          // The → An
        const removeAt = foldDraft(plan).indexOf("very ");
        plan = spliceAndCheck(plan, removeAt, removeAt + 5, "", "c");          // 删 "very "
        expect(foldDraft(plan).startsWith("An ")).toBe(true);
        expect(foldDraft(plan)).toContain("model");
        expect(foldDraft(plan)).not.toContain("very ");
        expect(deriveDiffs(plan).length).toBeGreaterThan(0);
    });

    it("整篇替换会吸收尾部插入编辑（回归：机械清理不重复追加文本）", () => {
        let plan = createPlan("hello");
        plan = applyDraftSplice(plan, 5, 5, " world", meta("e1")); // 末尾插入 → "hello world"
        expect(foldDraft(plan)).toBe("hello world");
        // 模拟 cleanMechanical：整篇 [0,len) 替换
        plan = applyDraftSplice(plan, 0, foldDraft(plan).length, "HELLO WORLD", meta("e2"));
        expect(foldDraft(plan)).toBe("HELLO WORLD");
        expect(plan.edits).toHaveLength(1);
    });

    it("locateMinimalSplice：求最小单区间变更（去公共前后缀）", () => {
        expect(locateMinimalSplice("abcdef", "abXYef")).toEqual({from: 2, to: 4, inserted: "XY"});
        expect(locateMinimalSplice("abc", "aXbc")).toEqual({from: 1, to: 1, inserted: "X"});
        expect(locateMinimalSplice("same", "same")).toEqual({from: 4, to: 4, inserted: ""});
    });

    it("setDraft 语义：整串回传经 locateMinimalSplice + splice 后 fold 回该串", () => {
        let plan = applySourceEdit(createPlan("a b c"), 2, 3, "B", meta("e1")); // draft "a B c"
        const nextDraft = "a B c!"; // 用户在末尾追加 "!"
        const splice = locateMinimalSplice(foldDraft(plan), nextDraft);
        plan = applyDraftSplice(plan, splice.from, splice.to, splice.inserted, meta("e2"));
        expect(foldDraft(plan)).toBe(nextDraft);
    });
});

describe("repair-draft 源锚定批注", () => {
    // 批注锚在不可变原文坐标上，草稿坐标一律派生。核心不变量：未改动区域投影 not stale；
    // 锚定区间被 edit 改动 → stale；由草稿选区反推的锚点投影回去要覆盖对应草稿选区。
    const annotation = (id: string, sourceFrom: number, sourceTo: number, quote: string): RepairAnnotation =>
        ({id, sourceFrom, sourceTo, quote, body: "note", resolved: false});

    it("未改动区域的批注：草稿坐标 = 原文坐标，not stale", () => {
        const plan = createPlan("hello world");
        expect(projectAnnotation(plan, annotation("c1", 6, 11, "world"))).toMatchObject({from: 6, to: 11, stale: false});
    });

    it("批注左侧发生编辑：批注随 delta 平移，not stale", () => {
        const plan = applySourceEdit(createPlan("hello world"), 0, 5, "hi", meta("e1")); // "hi world"
        expect(foldDraft(plan)).toBe("hi world");
        // 原文 "world" 在 [6,11)；左侧 "hello"(5) → "hi"(2)，delta -3
        expect(projectAnnotation(plan, annotation("c1", 6, 11, "world"))).toMatchObject({from: 3, to: 8, stale: false});
    });

    it("批注右侧发生编辑：批注坐标不动，not stale", () => {
        const plan = applySourceEdit(createPlan("hello world"), 6, 11, "there", meta("e1")); // "hello there"
        expect(projectAnnotation(plan, annotation("c1", 0, 5, "hello"))).toMatchObject({from: 0, to: 5, stale: false});
    });

    it("编辑落在批注锚定区间内：投影为 stale", () => {
        const plan = applySourceEdit(createPlan("hello world"), 6, 11, "there", meta("e1"));
        expect(projectAnnotation(plan, annotation("c1", 4, 9, "o wor")).stale).toBe(true); // [4,9) 与 edit [6,11) 相交
    });

    it("由草稿选区建批注锚点：在改后文本上选中改写段 → 锚回原文并标 stale", () => {
        const plan = applySourceEdit(createPlan("abcdef"), 2, 4, "XYZ", meta("e1")); // draft "abXYZef"
        expect(foldDraft(plan)).toBe("abXYZef");
        const anchor = annotationAnchorFromDraft(plan, 2, 5); // 草稿选 "XYZ"
        expect(anchor).toEqual({sourceFrom: 2, sourceTo: 4});
        expect(projectAnnotation(plan, annotation("c1", anchor.sourceFrom, anchor.sourceTo, "XYZ"))).toMatchObject({from: 2, to: 5, stale: true});
    });

    it("草稿选区落在未改区：锚点即原文坐标，投影 not stale（不误吞相邻 edit）", () => {
        const plan = applySourceEdit(createPlan("abcdef"), 2, 4, "XYZ", meta("e1")); // draft "abXYZef"
        const anchor = annotationAnchorFromDraft(plan, 5, 7); // 草稿选 "ef"（紧邻 edit 右侧）
        expect(anchor).toEqual({sourceFrom: 4, sourceTo: 6});
        expect(projectAnnotation(plan, annotation("c1", anchor.sourceFrom, anchor.sourceTo, "ef"))).toMatchObject({from: 5, to: 7, stale: false});
    });

    it("projectAnnotations 按草稿起点排序", () => {
        const plan = createPlan("0123456789");
        const views = projectAnnotations(plan, [annotation("b", 5, 7, "56"), annotation("a", 1, 3, "12")]);
        expect(views.map((view) => view.id)).toEqual(["a", "b"]);
    });

    it("批注圈住纯插入的文本：锚点零宽、投影覆盖插入段、判 stale", () => {
        const plan = applyDraftSplice(createPlan("hello"), 5, 5, " world", meta("e1")); // draft "hello world"
        const anchor = annotationAnchorFromDraft(plan, 6, 11); // 草稿选 "world"（全在插入文本内）
        expect(anchor).toEqual({sourceFrom: 5, sourceTo: 5});
        expect(projectAnnotation(plan, annotation("c1", 5, 5, "world"))).toMatchObject({from: 5, to: 11, stale: true});
    });

    it("纯插入紧贴批注边界：投影不吞插入文本、不误判 stale", () => {
        const plan = applyDraftSplice(createPlan("ab"), 1, 1, "X", meta("e1")); // draft "aXb"
        expect(projectAnnotation(plan, annotation("c1", 0, 1, "a"))).toMatchObject({from: 0, to: 1, stale: false});
        expect(projectAnnotation(plan, annotation("c2", 1, 2, "b"))).toMatchObject({from: 2, to: 3, stale: false});
    });

    it("投影透传批注携带的领域字段（provenance 等）", () => {
        const view = projectAnnotation(createPlan("abc"), {...annotation("c1", 0, 2, "ab"), source: "user" as const});
        expect(view.source).toBe("user");
        expect(view).toMatchObject({from: 0, to: 2, stale: false});
    });
});

// transitionKind 分类（Task 13 W7 契约第 8 条）：内容来源口径，优先级 user > llm > static。
describe("classifyTransitionKind", () => {
    it("全 static ⇒ static_fix", () => {
        expect(classifyTransitionKind(["static", "static"])).toBe("static_fix");
    });

    it("出现 llm 且无 user ⇒ llm_fix（含 static+llm 混合）", () => {
        expect(classifyTransitionKind(["llm"])).toBe("llm_fix");
        expect(classifyTransitionKind(["static", "llm", "static"])).toBe("llm_fix");
    });

    it("出现任何 user ⇒ user_fix（user 优先级最高）", () => {
        expect(classifyTransitionKind(["user"])).toBe("user_fix");
        expect(classifyTransitionKind(["static", "llm", "user"])).toBe("user_fix");
    });

    it("空数组 / null / undefined（拿不到编辑面状态）⇒ 保守 user_fix", () => {
        expect(classifyTransitionKind([])).toBe("user_fix");
        expect(classifyTransitionKind(null)).toBe("user_fix");
        expect(classifyTransitionKind(undefined)).toBe("user_fix");
    });
});

// 热力块投影（Task 16 R6）：块坐标锚 plan.source（head.body），逐块投影到草稿坐标；
// 空块（整块内容已删）剔除。pAi 原样透传（数值陈旧性不在纯函数职责内）。
describe("projectHeatChunks", () => {
    const chunk = (start: number, end: number, pAi = 0.5) => ({start, end, pAi});

    it("恒等：无编辑时投影坐标与源坐标一致，pAi 透传", () => {
        const plan = createPlan("0123456789");
        expect(projectHeatChunks(plan, [chunk(0, 4, 0.2), chunk(4, 10, 0.9)])).toEqual([
            {from: 0, to: 4, pAi: 0.2},
            {from: 4, to: 10, pAi: 0.9},
        ]);
    });

    it("编辑平移：块左侧的编辑改变长度，块整体随 delta 平移", () => {
        // "hello"(5) → "hi"(2)，delta -3；块 [6,11) = "world"
        const plan = applySourceEdit(createPlan("hello world"), 0, 5, "hi", meta("e1"));
        expect(foldDraft(plan)).toBe("hi world");
        expect(projectHeatChunks(plan, [chunk(6, 11)])).toEqual([{from: 3, to: 8, pAi: 0.5}]);
    });

    it("块内删除收缩：块中段被删，from 不动、to 按删除量收缩", () => {
        // 块 [0,10)，删 [4,6) → 草稿长度 8
        const plan = applySourceEdit(createPlan("0123456789"), 4, 6, "", meta("e1"));
        expect(foldDraft(plan)).toBe("01236789");
        expect(projectHeatChunks(plan, [chunk(0, 10)])).toEqual([{from: 0, to: 8, pAi: 0.5}]);
    });

    it("整块删除剔除：块完全落在删除区间内，投影为空区间被剔除", () => {
        // 删 [0,10)，块 [4,6) 整块消失；其后的块 [10,12) 正常平移
        const plan = applySourceEdit(createPlan("0123456789ab"), 0, 10, "", meta("e1"));
        expect(foldDraft(plan)).toBe("ab");
        expect(projectHeatChunks(plan, [chunk(4, 6), chunk(10, 12, 0.7)])).toEqual([{from: 0, to: 2, pAi: 0.7}]);
    });
});

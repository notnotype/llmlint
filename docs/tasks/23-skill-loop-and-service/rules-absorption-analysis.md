# story-deslop 规则吸收分析

> 结论：词表与简单句式**今天就能收**（现有 curated-import 路径）；真正高含金量的校准型检测器需要 3 个规则模型扩展才能收——引号遮罩（叙述/对白分域）、密度型 detector、位置窗口。少数纯算法检测器走已预留的 handler rule 通道。

## 1. 资产盘点（story-deslop，MIT）

| 层 | 资产 | 形态 |
|---|---|---|
| 词表/句式 | `references/banned-words.md`：毒级分层禁用句式（不是A而是B ★5）、一级/二级禁用词、书面腔映射、比喻五分类 | 纯词表 + 简单模板 |
| 确定性检测器 | `scripts/check-ai-patterns.js`：6 个 blocking（not-is 状态机、em-dash、音量反差、否定排比、反序对比、预告收尾）+ 14 个 advisory 密度型（套词/比喻/解释链/微动作/碎句号/长段落/低连接/过度精炼/公文腔/引号强调…） | 手写 JS，逐条带真人语料校准记录（《万疆》20 章 ≈0 误报） |
| 退化检测 | `check-degeneration.js`：复读打转、末尾截断、占位符、工程词泄漏（细纲/情节点） | 手写 JS |
| LLM 工作流 | SKILL.md Gate A–G、三遍法、删除优先判断、删除比例上限、量化定档表、`.deslop-whitelist` 白名单 | 提示词/流程 |

## 2. 与 llmlint 现有模型的逐类对照

llmlint 规则 = 声明式 JSON（detector: regex|llm；action: replace|suggest；level/review/fixability 三维），scanner 逐规则全文跑正则，只有 markdown 遮罩。HandlerRuleRecord 已在 types.ts 定型但 v1 不执行（trustedRulesets 门已预留）。

| story-deslop 能力 | llmlint 现状 | 可收性 |
|---|---|---|
| 禁用词表、书面腔映射 | 大量重叠（cliche.body-reaction、modifier、vocabulary.body、transition.summary、ending.elevation、numeral.three、collection.deepseek 等，已并 shuorenhua/avoid-ai-writing/humanizer） | ✅ 差集导入即可，走 curated-import，`source.importedFrom` 记出处 |
| 音量反差/否定排比/预告收尾/反序对比等 blocking 正则 | contrast.binary 有基础版「不是而是」，无这些校准变体 | ✅ 纯正则可直接表达（反序对比的前字排除可用 lookbehind 字符类），**校准注释一并搬** |
| not-is 状态机（确认语/either-or/跨空行等精细排除） | 简化正则版存在，误报面更大 | ⚠️ 正则表达不全 → handler rule |
| 密度型检测器（minHits + perKilo + 多桶 + core 门槛，全文只报一条） | **无法表达**。现有 punctuation.dash-proliferation 只是逐处正则，rhythm 靠 LLM 规则 | ❌ 需新 detector 类型 `density` |
| 只扫引号外叙述（maskQuoted/stripQuoted） | **无**。只有 markdown 遮罩 | ❌ 需 scanner 级引号遮罩 + 规则级 scope |
| 位置窗口（trailer-ending 只扫末 600 字、opening 只扫开头） | opening.cliche/ending.elevation 无位置约束，靠正则内容近似 | ❌ 需 scope.position 小扩展 |
| 退化检测（复读/截断/工程词） | mechanical.* 有占位符/零宽/同形字/chatbot 泄漏；缺复读、截断、工程词 | ⚠️ 工程词=regex 直收进 mechanical；复读/截断=handler |
| 白名单 `.deslop-whitelist`（词级豁免） | 只有规则/namespace 级 off，无词级豁免 | ❌ config 加 `ignoreTerms`（项目级） |
| Gate A–G、三遍法、删除优先、比例上限、定档量表 | SKILL.md workflow + llm 规则（rhythm 等）部分覆盖 | ✅ 属工作流层，融进 Task 23 五步流程与 llm 规则 prompt，不进 regex 注册表 |

## 3. 关键判断

1. **引号遮罩是最大的一个缺口，且收益覆盖全部 340 条现有规则**。story-deslop 几乎所有检测器都只看叙述层——口语对白里「不是…是…」是自然辩解，不遮罩就收不了这批规则（会在台词上洪水误报）。方案：scanner 增加成对引号区间计算（与 markdown 遮罩同一 MaskedRange 机制），规则加 `scope: "narrative" | "dialogue" | "all"`（缺省 all，向后兼容）。
2. **密度型 detector 建议做成声明式而不是全走 handler**：`{type:"density", patterns[], minHits, perKilo, scope, coreMinHits?}`。理由：llmlint 的核心创新是「用户也能供规则」——声明式规则是可上传共享的数据，handler 是代码，共享即安全问题。14 个 advisory 检测器约 10 个可用该形态表达。
3. **handler 通道只留给真算法**（not-is 状态机、低连接/过度精炼、碎句号 run、复读/截断）：types.ts 已定型 HandlerRuleRecord + trustedRulesets 门，正好是设计预期的启用时机；只随 builtin 分发，不接受第三方 handler。
4. **校准纪律与 eval harness 天然同构**：story-deslop 的 blocking 规则带「真人语料 ≈0 命中」验收线，导入后直接过 evals 量 lift，等于免费拿到一批预校准高置信规则；这正是环①③的输入。
5. severity 映射：blocking → level:high + review:agent；advisory → level:low~medium + review:agent/human 按误杀风险分桶（与现有 human 桶策略一致）。

## 4. 建议吸收顺序

1. 词表差集 + 可正则化的 blocking 规则 → 新 ruleset 目录（如 `rules/narrative/`），`source.importedFrom: "oh-story-claudecode/story-deslop"`（MIT attribution）。
2. scanner 引号遮罩 + `scope` 字段（先行，因为第 1 步的规则大多声明 `scope:"narrative"` 才安全）。
3. `density` detector 类型 + 10 条密度规则移植。
4. handler 执行启用（builtin-only）+ 4~5 条算法检测器移植 + 退化检测并入。
5. config `ignoreTerms` 词级白名单。
6. 工作流层（Gate/三遍法/删除优先/比例上限）融进 Task 23 分片 1 的 SKILL.md 改写。

story-oracle（无 LICENSE）不进规则注册表，只在修复指导提示词中提炼原则（三工序流水线、对白甲乙丙分类、数据包腔例外）。

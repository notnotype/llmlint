# 检测工作台打磨轮

> Task 16：Task 15 检测工作台落地后的第一轮浏览器实测打磨（2026-07-09 用户 8 点需求）。
> 上游：[Task 15](../15-detection-workbench/README.md)（工作台形态与采集语义权威）、[Task 07](../07-web-review-editor/README.md)（编辑器）。

## User Request / Topic

用户 8 点（2026-07-09）：

1. **规则显隐**（R1）：规则太多，每条规则可手动隐藏；显示时高亮 + 可替换规则出校对修订符号。
2. **inline 规则菜单**（R2）：点击修订/命中单击打开 inline 菜单（规则信息 + 应用替换 + 隐藏）。
3. **规则分类**（R3）：规则列表区分「LLM 规则 / 有替换 / 无静态替换」。
4. **verdict 分级主体色**（R4）：强判别/弱判别等有效等级，不同等级不同主体颜色。
5. **编辑器 diff**（R5）：看自己改了哪里。
6. **热力图进编辑器**（R6）：AI 味越重背景越红，直接画在编辑器文章背景。
7. **AI 改写迁右侧 tab**（R7）。
8. **报告说人话**（R8）：指标配白话解释 + 统计汇总（命中 N 条、强判别 X 条…）。

**三拍板（勿重议）**：① 隐藏规则后报告统计保持服务器全量口径，仅注明「其中 N 条来自你隐藏的规则」；② diff 基线=草稿 vs head（本轮未提交改动），开关默认关；③ LLM 规则入 /rules 主表+类型徽标，统计「—」注明未参与扫描。
**行为反转（用户明确要求）**：点击校对符号从 Task 15 P2-E 的「直接应用」改为「打开 inline 菜单」；热力「编辑态不叠」旧拍板推翻（piece-table 坐标映射解决漂移）。

## 关键事实（方案依据）

1. 规则启停机制已存在：`settings.ruleOverrides[id].enabled` + materializeRules（enabled:false 从 registry.regexRules 整体剔除）→ 本地扫描/高亮/校对符号/命中列表/autoFix/批量全链自动跟随；/rules 页用 baseRegistry 不受影响=恢复入口；服务器 MachineScan 独立=报告全量口径天然成立。
2. 服务器 hits 含 ruleId（MachineScanHitDto）→ 强判别/隐藏命中统计前端 join `baseRegistry.ruleVerdicts`，后端零改动。
3. BubbleMenu 选区驱动不适用点击浮层；`@floating-ui/dom` 提升为直接依赖（已在依赖树，零安装增量），自建 RuleInlineMenu。

## 工单拆分

| 工单 | 内容 | 状态 |
|---|---|---|
| W0 地基 | verdict-badge/rule-category 两 util、settings 键 draftDiff/editorHeatmap、@floating-ui/dom 依赖、i18n 骨架 | ✅ |
| W1 编辑器层 | R2 inline 菜单+点击改造、R5 effectiveDiffs+forceDiffs、R6 heat 装饰层+projectHeatChunks | ✅ |
| W2 规则分类与命中卡 | R3 llmRules 入表+类型徽标、R4 verdict 主体色、R1 规则页开关+命中卡隐藏按钮 | ✅ |
| W3 工作台右栏 | R7 aiFix tab+AiFixPanel、R8 汇总卡+解释行+summarizeScanHits、contribute.vue 接线收口 | ✅ |

## Implementation Walkthrough / 执行记录

**W0 地基**（主循环，2026-07-09）：`web/app/utils/verdict-badge.ts`（VERDICT_BADGE/UNTESTED_BADGE/verdictBadge 单源，扩展 borderCls 主体色）、`web/app/utils/rule-category.ts`（ruleCategory 三分类 + CATEGORY_BADGE）、web-settings.ts 两新键（draftDiff/editorHeatmap 默认 false，type/default/normalize 三处）、package.json 提升 @floating-ui/dom ^1.7.6（已在依赖树零安装增量）、i18n rules.type* 三键。

**W1 编辑器层**（agent，一次进程中断后带盘点清单续跑完成）：
- R2：新 `RuleInlineMenu.vue`（~250 行，floating-ui computePosition+flip/shift，Teleport `.llmlint-theme`，Esc/外点/滚动自关）；ReviewEditor handleClick 的 proofread 与 issue-mark 两分支改开菜单（**推翻 Task 15 P2-E 点击即应用，用户明确要求**）；应用走既有 acceptReplacement，隐藏经 hide-rule 由 TextPanel 消化（setRuleOverride enabled:false + 撤销通知）；ReviewIssueMark 加 note?/verdict?，TextPanel 从 baseRegistry.ruleVerdicts 注入。
- R5：effectiveDiffs computed 门控全部 diff 消费点（settings.draftDiff ‖ props.forceDiffs），工具栏 git-compare 开关（source/preview 双模式）。**行为变化申报：playground 默认不再显示已应用替换的 diff 痕迹**（拍板②默认关全局执行，开关随处可开）。
- R6：`projectHeatChunks(plan, chunks)` 纯函数（repair-draft.ts，私有 sourceToDraftClamped 处理端点落删除段的截断，直接用 sourceToDraft 左偏近似会出界）；ReviewEditor preview 装饰层铺 heatColor 底色，`.is-heat` 下命中改下划线、diff 绿底加 !important 压过热力 inline style；热力块按源文本逐行定位（preview 折叠空行致跨段 needle 失配，同块各行共享 pAi）。
- 测试：tests/repair-draft.test.ts +4 用例（恒等/平移/收缩/整块剔除）。i18n review.* 6 键。

**W2 规则分类与命中卡**（agent，一次输出中断后续跑完成）：
- R3：RuleCatalogRow.rule 放宽 `RegexRuleRecord | LLMRuleRecord`（波及 DimensionBadges prop 放宽为 ActiveRuleRecord，已申报处理）；8 条 llmRules 入 /rules 表殿后（stat 恒 null）；类型 chips（全部/LLM/有替换/仅检测带计数）与 verdict chips 交集过滤；LLM 行统计「—」、展开隐藏 targets 显 prompt 概要 + rules.llmNotScanned 注记；IssueCard 类型徽标。
- R4：RulesCatalogTable 本地徽标删除改引 W0 单源；IssueCard 新 verdict 三态 prop（undefined=报告缺失降级不显示 / null=未测徽标 / 值=徽标+border-l-4 主体色）；IssueList verdicts 映射逐卡透传（verdictOf 精确保留两态）。
- R1 入口：/rules 行级显示/隐藏开关（恢复=清除 enabled 覆盖而非写 true，其余覆盖保留；LLM 行无开关；隐藏行 opacity-50）；IssueCard 隐藏按钮（只 emit）。i18n 6 键。

**W3 工作台右栏**（主循环）：
- R8：`summarizeScanHits(hits, meta)` 纯函数（contribute-workspace.ts；strong join 烘焙 verdicts、autoFixable=auto+replace 全量目录判据、hidden=∈默认生效集 ∉用户生效集）+4 vitest 用例；ReportPanel 新 scanSummary prop + 白话汇总卡（总命中/强判别/可自动修复/隐藏注明——拍板①全量口径）+ 四处指标解释行（processExplain/docScoreExplain/detectExplain/compareExplain）。
- R7：新 `AiFixPanel.vue`（外部 LLM 菜单/整篇发起/取消/unavailable 注明/流式面板/选区引导；editorActive=false 时发起禁用引导回 head）；contribute.vue RightTab 加 "aiFix"（tab 按钮运行中 spinner、未揭示禁用），编辑工具行瘦身只剩「只读标注」+strong 口径注明；顺带修复 Task 15 观察项「查看旧版时取消按钮不可达」。
- 接线：TextPanel :heat（head.detects[0].chunks）/:force-diffs（llmReviewOpen）；IssueList :verdicts/@hide-rule（hideRule 带撤销通知 + 激活指针兜底）；ReportPanel :scan-summary。i18n contribute.* 14 键 + notify.ruleHidden。

## Verification / Test

终验（2026-07-09，主循环）：web `bun run typecheck` exit 0（含 build-registry：303 regex+8 llm、verdict 烘焙 160 条 strong 7）；`typecheck:server` exit 0；仓根 `bunx vitest run tests/` = **112/112**（4 文件，新增 summarizeScanHits 4 + projectHeatChunks 4）；`bun test evals/` = **44/44**（本轮 evals/ 零改动，model-client.ts 的未提交改动为 Task 15 流式函数遗留）；web/data.db 与 eval.config.json 未动。

### 浏览器验收清单（接 Task 15 第 49 步）

50. 命中 tab 规则卡：verdict 徽标与左边框主体色（强判别绿/弱琥珀/噪声灰/反指标红/未测边框灰），与 /rules 页徽标同色；类型徽标（有替换/仅检测）。
51. 隐藏规则三入口：编辑器点命中→inline 菜单「隐藏此规则」；命中卡 eye-off 按钮；/rules 行级开关。隐藏后编辑器高亮/校对符号/命中列表即时消失，撤销通知可恢复，/rules 页开关可恢复（隐藏行半透明）。
52. 报告 tab 白话汇总卡：总命中/强判别 X 条/可自动修复 Y 条；隐藏规则后报告统计不变但出现「另有 N 条来自你隐藏的规则」注明。
53. 报告各指标解释行（进程/docScore/P(AI)/对比卡）中英文都在。
54. 编辑器点击命中高亮/校对符号 → inline 菜单（规则标题/说明/verdict 徽标/应用替换/隐藏）；Esc/点外/滚动关闭；应用替换生效；点原文仍是定位。
55. diff 开关：默认关（打字/应用替换无绿底红删）；工具栏 git-compare 开启后显示草稿 vs head 修改痕迹；AI 改写审阅横幅打开时强制显示；刷新记忆。
56. 编辑器热力：head 有检测数据后工具栏出现热力开关（preview 模式）；开启铺绿→红底色、命中改下划线；编辑文字后热力位置跟随；与 diff 同开时 diff 绿底优先；刷新记忆。
57. AI 改写 tab：发起/流式/取消都在右栏；运行中 tab 显 spinner；查看旧版时取消仍可达；发起按钮在非 head 编辑视图禁用并引导；外部 LLM 三动作照旧。
58. /rules 页：8 条 LLM 规则入表（类型徽标、统计「—」、展开注明未参与扫描）；类型 chips 筛选与 verdict chips 交集；英文全线。

## 浏览器走查与打磨轮（2026-07-09，主循环 playwright 实测）

用户授权浏览器验证后，主循环用 playwright-cli 全流程走查：上传→盲评→报告 tab（汇总卡/进程/多维/解释行/P(AI) 100% 热力缩略条）→预览模式（校对符号/inline 菜单开合/菜单内应用 11→10/菜单内隐藏规则 10→7 联动+撤销通知+报告「另有 4 处来自你隐藏的规则」注明）→热力/diff 开关（截图核验梯度底色与绿底插入并存）→AI 改写 tab（真调 mimo：流式面板→diff 并入→审阅横幅 1/5→forceDiffs 强开）→再次检测建 rev1（transitionKind=AI 改写）→对比卡/复评表单→/rules 页（类型 chips 计数 8/256/47、隐藏行搜索定位、恢复显示、LLM 8 条统计「—」）。零 console 错误。

走查发现并已修复 4 项：

1. **编辑器默认 source 模式**（重要 UX 断层）：Task 16 全部新交互（inline 菜单/校对批注/热力/diff）都是 preview 限定，新用户默认看不到。修复=`defaultWebSettings.reviewEditorMode` 改 "preview"，normalize 同步认两值（老用户已存的 "source" 偏好保留不被强切）。
2. **校对符号 title 文案过时**：三处仍写「点击应用」而 R2 已改为点击开菜单。修复=review.proofreadApplyHint/OnTitle/OffTitle 改「点击符号打开规则菜单应用」（zh/en）。
3. **汇总卡「可一键自动替换」口径与批量应用打架**：summarizeScanHits 的 autoRuleIds 原判据仅 fixability=auto（实测显示 0 处），而命中列表批量应用判据是 isIssueAutoApplicable（auto|candidate + replace，实际可点 14 处）。修复=scanMeta 判据对齐 isIssueAutoApplicable（复验显示 14 处）。
4. **上传屏标题口径**：「贡献检测数据」（Task 06 时代）改「检测正文」（W9 检测入口语义）；引导条 workspace 文案补三 tab 口径（AI 改写在右侧页签）。

复验：新会话全流程（默认预览✓/新文案✓/汇总 14 处✓/标题✓）；vue-tsc 0 错误；vitest 112/112。

## TODO / Follow-ups

- [ ] 浏览器验收 50-58（主循环已 playwright 全流程走查通过，用户可抽验）
- [ ] W1 deviation 5：forceDiffs 强开期间 draftDiff 开关按钮仍可点（只改偏好），要不要禁用待用户反馈
- [ ] 热力块含 Markdown 语法的行可能定位失败被跳过（与命中定位同限制），实测明显再优化
- [ ] playground 默认不再显示替换 diff 痕迹（R5 全局默认关）；若不可接受，兜底=playground 传 `:force-diffs="true"` 一行

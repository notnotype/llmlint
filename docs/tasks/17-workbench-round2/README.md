# 工作台第二轮：源码编辑器统一 + 综合评分报告 + LLM 规则检测

> Task 17：Task 16 浏览器验证后用户提出的 6 点（2026-07-09）。
> 上游：[Task 16](../16-workbench-polish/README.md)、[Task 15](../15-detection-workbench/README.md)。

## User Request（6 点）+ 三拍板

1. 取消独立「只读标注」模式，标注能力融合进编辑器。
2. **禁用预览视图**（以后再考虑删除）；编辑器概念上维护两份文本：原始检测正文（上传后只读）+ 修改稿（LLM 可改/静态可替换/用户可编辑）——即现有 piece-table source/draft 模型的 UI 明确化。
3. 源码选区菜单单击（拖选松手）即显示，不要双击才显示。
4. 命中规则列表按判别强度（verdict）排序。
5. 新增「静态修复」（应用全部静态替换）与「一键修复」（静态修复 → 接着 LLM 改写）。
6. 检测报告改版：测速网站式综合评分 + 检测动画，指标全部中文化（可带英文括号）。
7. 接入 llmlint 的 LLM 规则检测（8 条规则真调 LLM）。

**拍板（2026-07-09）**：① 预览限定能力移植到源码模式（inline 菜单/热力底色进镜像层；校对批注行内建议文本 textarea 做不了随预览雪藏）；② 综合评分 = 0-100 分+色环（**推翻 Task 15「并列展示不合成综合分」旧拍板**；主分=检测器 P(AI) 与规则命中密度加权，缺检测器降级为规则面分并注明；分项指标仍在下方展开）；③ LLM 规则检测=服务端自动异步（同外部检测器模式：轮询落库；mimo 通道一次调用带全部规则出结构化命中）。

## 工单

| 工单 | 内容 | 状态 |
|---|---|---|
| A 编辑器轮（1/2/3+移植） | 禁用预览、inline 菜单+热力移植镜像层、标注融合（draftToSource 映射）、选区菜单单击 | ✅ |
| C LLM 规则检测（7） | 新表 MachineLlmReview、服务端异步、machine/hydrate 带出 | ✅ |
| B 排序与修复按钮（4/5） | verdict 排序、静态修复/一键修复 | ✅（主循环） |
| D 报告改版（6） | 综合分+色环动画+中文化 | ✅ |

## Implementation Walkthrough / 执行记录

**A 编辑器轮**（agent，429 中断一次后经盘点续验收——实际已完工）：`previewDisabled=true` 常量守卫（切换按钮+快捷键停用，代码保留待删）；inline 规则菜单进源码模式（点击命中经 caret-click 链 + floating-ui 虚拟锚点，「点到什么开什么」优先级 批注 > diff > 命中菜单）；HighlightedTextarea 加 heat prop（背板热力底色，热力开时命中转下划线——背板文字透明但 text-decoration 单独着色可见）；「只读标注」独立模式删除（headReadOnly 清零），选区菜单加「保存标注」→ TextPanel expose `mapDraftSpanToSource`（draftToSource 映射+实文校验，跨已编辑段返回 null 提示不落库）→ 标注挂 head.revisionId 锚落库 body 坐标（采集红线保全）。

**C LLM 规则检测**（agent）：新表 `MachineLlmReview`（revisionId+model+promptVersion 唯一；hitsJson={hits:[{ruleId,quote,reason,span|null}], meta:{truncated}}；空命中也落行区分「未评审 vs 无命中」）；`evals/generator/llm-rules-prompt.ts` 注册表（llm-rules-v1，8 条规则一次调用，独立于 repair 线）；`web/server/utils/llm-review.ts`（通道复用 eval.config repair.model=mimo、JSON 解析容错+重试一次、quote→UTF-16 span 回定位、>12000 可见字前缀截断）；texts/revisions POST 后 `event.waitUntil` 与 detect 并列异步；reveal/machine/workspace 三端点带出（D2 口径：未揭示不带）。真调验证：2 命中 span 全部回定位成功、reveal 前 machine 403。

**D 报告改版**（agent）：`compositeAiScore(scan, detects)`——0-100「AI 味指数」（高=AI 味重），有检测器=0.65×mean(docPAi)+0.35×规则面分，规则面分=docScore 对当前 report.json 基线（人类中位 19.5/AI 25.2，注：与旧记忆 14.7/20.8 不同属当前构建实测）S 型归一；无检测器=纯规则面+降级注明；四档等级词（很重/明显/轻微/接近人写）。ScoreRing（SVG 色环+rAF count-up，绿→红 HSL 与热力同色语义）、DetectingAnimation（纯 CSS 脉冲雷达）、prefers-reduced-motion 适配；报告重排=色环主卡置顶+汇总并入+进程压缩为三路图标行+分项卡中文化（规则命中(rule hits)/命中密度(docScore)/AI 概率(P(AI))）；LLM 评审卡（模型名+逐条 ruleId/quote/reason，null=等待行）。6 用例测试。

**B + 收口**（主循环）：groupByRule 改判别强度排序（strong 5>weak 4>untested 3>insufficient 2>noise 1>anti 0，同档按命中数）；「静态修复（N）」按钮=acceptIssueReplacements 全部可自动替换命中（**口径与汇总卡/批量应用对齐 isIssueAutoApplicable**——初版误用 D-D strong∩auto 空集口径显示 0，浏览器走查抓到即修）；「一键修复」=静态修复→nextTick→startLlmFix（快照时序注释）；pollDetects 修 C 申报的轮询缺口（detect 先到不再提前退出，继续等 llmReview 到两路齐或上限；exhausted 只在 detects 缺时置；三处调用点条件同步放宽）；进程行 LLM 评审 null 态文案从「未接入（占位）」改「评审中（异步约 1–2 分钟…）」。

## Verification / Test

静态：web typecheck + typecheck:server 双 0 错误；vitest 118/118（新增 compositeAiScore 6 + projectHeatChunks 4 已计入）；bun test evals 44/44；eval.config.json/web/data.db 未动。

浏览器终验（playwright 真跑，2026-07-10）：上传→跳过盲评→**色环主卡 100/100 AI 味很重**（检测器未到时降级注明正确，到达后切完整口径）→进程三路（LLM 评审 ~1 分钟落库转绿勾）→**LLM 评审卡真数据**（mimo 指出 monotone-rhythm 1 处含 quote+理由）→源码模式**点击命中弹 inline 菜单**（虚拟锚点）→**拖选一次松手选区菜单即显示**→**「保存标注」全链**（表单→映射→落库→「标注已保存」）→**静态修复**（23 处应用、命中 8→2、净 -5 字、撤销钮在）→**「一键修复」全链**（静态 11→0→LLM 自动发起→diff 并入→审阅横幅 1/4）。零 console 错误。

### 浏览器验收清单（接 Task 16 第 58 步）

59. 编辑器无「源码/预览」切换（预览已禁用）；快捷键 Ctrl/Cmd+Alt+T 无效。
60. 点击正文命中高亮 → inline 规则菜单（源码模式）；应用/隐藏照旧。
61. 编辑器热力开关（工具行）：开启铺底色、命中转下划线。
62. 拖选正文一次松手 → 选区菜单出现；菜单含「保存标注」→ 填写保存 →「标注已保存」；对已编辑过的片段标注 → 提示改标未修改片段。
63. 命中列表按判别强度排序（强判别组在最前）。
64. 「静态修复（N）」计数与汇总卡「可一键自动替换」一致；点击批量应用+可撤销；再点可继续收敛残余。
65. 「一键修复」：静态修复后自动发起 AI 改写，流式/审阅横幅照旧。
66. 报告：色环综合分+等级词+count-up 动画；检测中显示脉冲雷达；检测器缺失时降级注明。
67. 指标中文化（规则命中/命中密度/AI 概率，带英文括号）；进程三路图标行。
68. LLM 评审卡：约 1–2 分钟后出现模型名+逐条命中（ruleId/引文/理由）；无命中显示「未发现」；通道未配置恒等待行。
69. 英文界面全线。

## TODO / Follow-ups

- [ ] 浏览器验收 59-69（主循环已 playwright 走查通过，用户可抽验）
- [ ] 校对批注（Task 16 7b）随预览雪藏；预览彻底删除时一并清理 proofread 代码与 settings 键
- [ ] LLM 评审命中的正文定位跳转（span 已回定位，点击卡片跳编辑器未做）
- [ ] 综合分口径基线随 report.json 重建漂移（DOC_SCORE_BASELINE 是常量快照）——考虑构建期烘焙进 rules-report.json
- [ ] 静态修复一次不收敛（重叠候选跳过）属已知语义；如需一键收敛可循环应用至不动点

## 2026-07-11 静态修复口径纠正

典型 AI 正文复现证明，Task 17 B 轮把 `candidate` 纳入 `isIssueAutoApplicable` 后会一次应用 81 个语义替换，并把 agent 候选从 29 清到 0；这与 Rule Registry 的 `candidate=需上下文判断` 契约冲突。

现已拆成两个谓词：`isIssueAutoApplicable` 仅接受 `fixability:auto`，服务「机械修复 / 一键修到底」的第一阶段；`isIssueReplacementApplicable` 接受 auto/candidate，只服务单条按钮、规则组应用与用户主动选择的批量操作。汇总卡「可一键自动替换」同步只统计 auto，按钮与中英文说明改为“确定性机械修复”。

与原计划的出入：不再等待 strong∩auto 才让机械清理显现。verdict 衡量 AI 判别力，auto 衡量机械安全性，两者解耦；report task profile 改在 LLM 候选选择处消费。

## 2026-07-11 第二轮权限与 Profile 收口

默认规则不再提供 candidate：303 条 regex 中只有 3 条机械规则 auto，其余 300 条 manual。`isIssueReplacementApplicable` 的 candidate 分支仍保留给用户配置的显式白名单，但默认创作流程不会出现语义规则的一键删除/替换按钮。规则页的 replace 类型文案改为“替换模板”，明确模板不等于操作权限。

工作台 LLM 清单改为直接消费 registry 的 `creativeProfile.includedRuleIds`；服务端不再重复解释 verdict。原始 MachineScan、报告指标和规则页仍看完整超集。指定 `index2.md` 的结果为全量命中 115、auto 0、LLM 创作候选 17、候选重复 span 0。

与 Task 17 原浏览器走查的出入：当时“静态修复 23 处”包含旧 candidate 默认值，现已不再代表默认产品行为；本轮未自动重跑浏览器验证，保留验收清单供用户后续抽验。

## 2026-07-11 三维报告升级

旧“色环综合分主导”已被本轮拍板替代：报告顶部改为规则引擎、外部检测、LLM Agent 三张等宽主卡；综合分降为次级汇总，权重固定 30%/45%/25%，未完成通道不计入且对其余权重重新归一。外部检测和 LLM 卡按 waiting/running/completed/failed/cancelled/interrupted/unavailable 投影，运行中可真实取消，失败/取消/重启中断可创建新 attempt/invocation 重试。

LLM 卡不再只报命中数：多轮分析 Agent 必须通过工具读完全部约 4000 可见字正文块，才能提交 score/confidence/conclusion/evidence/suggestions；报告正文展示真实 llmlint 扫描汇总、Agent 结论、关键证据、建议和可展开命中明细，分数只出现在主卡。

验证：web client/server typecheck 双绿；Vitest 135/135；evals Bun tests 52/52。按用户要求未自动执行浏览器验证。

## 2026-07-11 风险语义与 mimo 评审收口

报告不再使用容易被误解为稿件质量的裸“100 分”：三张主卡和次级综合项统一标为“AI 痕迹风险”，越高越可疑，视觉恢复绿→黄→红；顶部明确说明这不是稿件质量分。LLM 完成态可直接“重新评审”，运行中仍可取消。

LLM prompt 从 v3 升为 `llm-rules-agent-v4`。模型不再自由打分，也不在 `report_result` 重复提交 evidence；`record_rule_hit` 是命中事实的唯一来源，服务器按已校验 hits 生成 evidence，并按可见千字加权密度校准风险分。这样从合同上消除了 mimo 二次抄写 quote/ruleId/reason 时细微漂移导致整份报告失败的问题。

真实 smoke 结果：`index2.md` 3 轮完成、0 命中、风险 0；人为反例 4 轮完成、记录 11 处命中，覆盖 monotone rhythm、过度解释、金句感、机械升华等目标规则。与原计划的出入：没有继续要求模型挑选“最多 8 条关键 evidence”，而是服务器按已确认命中顺序截取 8 条；稳定性优先于让小模型重复整理同一份结构化事实。

验证：Vitest 141/141；evals Bun tests 52/52；web client/server typecheck 均通过（client 仍输出既有 Vue route-block plugin 警告但退出码为 0）。按要求未自动执行浏览器验证。

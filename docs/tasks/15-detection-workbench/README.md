# 检测工作台：从五步向导到版本化工作台

> 本文是检测工作台重构的**设计定稿 + 实施规格**，按 walkthrough 规则持续更新。
> 上游：[Task 13](../13-web-five-step-flow/README.md)（五步流程 W1–W9 全部收口，本任务在其上重塑信息架构，**不推翻数据模型与采集语义**）、[Task 07](../07-web-review-editor/README.md)（编辑器）、[Task 12](../12-unified-data-model/README.md)（数据模型）、[METHODOLOGY §2.3](../../../evals/METHODOLOGY.md)（五步权威流程——退为引导叙事层，采集点全部保留）。

## Relative documents refs

- [Task 13 web-five-step-flow](../13-web-five-step-flow/README.md) — 五步流程与 W1–W9 执行记录（本任务的直接基座）
- [Task 12 unified-data-model](../12-unified-data-model/README.md) — Revision 谱系 / MachineScan+Detect / 闸门
- `web/app/pages/contribute.vue`、`web/app/components/*`、`web/server/api/*`、`evals/generator/model-client.ts` — 改造对象

## User Request / Topic

用户浏览器实测五步流程后提出 8 点（2026-07-08），归纳 = **从「五步采集向导」演进为「版本化的检测与润色工作台」**：

1. 规则级评测数据可视（哪些规则强判别，像评测报告一样）；
2. 检测历史可查、可恢复到工作区继续；
3. 检测器热力图显示；
4. 检测报告与润色合并为一个工作区；
5. 右侧主位=检测进程+多维报告（IssueList 降为 tab）；
6. stepper 位置改为版本切换 +「再次检测」（保存版本并重新检测）；
7. 编辑器丰富：按规则批量应用修正 + 校对批注式行内建议（删除线/替换符，点击应用）；
8. LLM 修复可见进度（流式输出；ReAct agent 后置）。

**六点拍板（2026-07-09 用户「全部同意」按推荐）**：① 验收/复评并入每个版本的报告 tab（独立验收屏消失）；② 版本切换=只读查看旧版，编辑恒基于最新版（分叉后置）；③ 历史只看自己的（全站共享后置）；④ 流式=轮询 partial 字段（SSE 后置）；⑤ 规则数据独立「规则」页；⑥ 分期 P0 工作台骨架 → P1（历史/热力图/规则页/7a）→ P2（7b 校对批注/8 流式）。

## Goal

> 把 `/contribute` 从「draft→report→edit→verdict→done 五屏向导」重塑为「draft → **workspace** → done 三态 + 版本化工作台」，并补齐规则数据页、历史恢复、热力图、校对批注、流式进度。
>
> - **Constraints**：数据模型零改动（schema 不动）；**采集语义全保留**（D2 盲评闸门、复评四维、span 标注、blind 判定、D5 口径——见「采集点落位表」）；W7 的 AI 改写 diff 审阅制不破；多维报告**并列展示不合成单一分**（docScore 等权局限教训）。
> - **Boundaries**：web/ 为主；evals/ 只许新增（流式函数不动线 A 旧路径）；构建脚本可扩。

## 目标形态

```
┌ 顶栏：阶段指示（上传 → 工作台 → 完成）        版本条：rev0→rev1→rev2(当前) [再次检测] ┐
├───────────────────────────┬──────────────────────────────────┤
│ 左：编辑器（activeRevision=head 时）│ 右：Tab                              │
│  · 规则命中高亮 + 校对批注(P2)      │  ① 检测报告（默认）：                    │
│  · AI 改写(流式预览 P2)+选区改写     │    盲评卡（rev0 未揭示时整个 tab 只显示它）  │
│  · 外部 LLM 三动作                │    检测进程 checklist（引擎✓/检测器⏳/LLM评价—占位）│
│ 左：只读正文+热力图层（查看旧版时）    │    多维报告卡：命中·docScore·P(AI)·热力缩略  │
│                              │    rev_k(k≥1)：与 rev0 对比 + 复评四维 + D5 │
│                              │    「完成本篇」出口（总结卡保留）             │
│                              │  ② 命中列表：IssueList + 按规则批量应用(7a)  │
└───────────────────────────┴──────────────────────────────────┘
```

## 关键设计

### 状态机与版本条

- `SubmitStep`: `draft → workspace → done`。workspace 内部态：`activeOrdinal`（查看的版本，默认=head）、`rightTab`（report|issues）。
- **版本条** = LineageStrip 可点击化：点 chip 切换查看；`activeOrdinal < head` 时左侧为**只读正文**（AnnotatableRevisionText + 热力图层 + 该版报告），编辑器只在 head 视图出现（拍板②）。切换离开 head 时若有未提交草稿改动 → 提示（不丢弃，切回 head 恢复编辑现场；实现上编辑器组件保活或快照恢复，agent 选最小方案申报）。
- **「再次检测」**（版本条右侧主按钮）= 现 commitRevision 的重命名迁位：草稿≠head 时可用，保存新版本→服务端扫描/检测→版本条追加→报告 tab 刷新为新版。
- 五步方法论退到引导条叙事；W8 的 FlowStepper 改造为「阶段指示」（三态）+版本条（stepper 五步节点退役，引导条/总结卡/主 CTA 纪律保留）。

### 采集点落位表（采集语义保全清单，验证按此逐条核）

| 采集点 | 工作台落位 | 语义不变量 |
|---|---|---|
| 盲评两轴（rev0，blind=true） | 首次进 workspace 时报告 tab = 盲评卡（打分/跳过），提交前不渲染任何机器结果 | D2：服务端 revealedAt 闸门本就强制，UI 同步不偷跑 |
| 复评四维 + D5 | 查看 rev_k(k≥1) 的报告 tab 内（与 rev0 对比恒定基线） | blind=false 自洽（reveal 先行）；D5 三态口径不变 |
| span 标注 | 只读正文视图（任意版本）选中标注，挂对应 revisionId | 坐标=该版 body；annotated 计数保留 |
| transitionKind/provenance | 「再次检测」提交时照旧（classifyTransitionKind + aggregateProvenanceEdits） | W7 口径 user>llm>static |
| 总结卡 | 报告 tab「完成本篇」出口 → done | W8 语义 |

### 数据契约（后端地基）

- **历史列表** `GET /api/texts`（当前用户，含匿名）：`[{textId, preview(sourceNote 或正文前 30 字), createdAt, revisionCount, latestOrdinal, latestDocScore?}]` 按 createdAt desc。
- **工作台恢复** `GET /api/texts/:id/workspace`（owner 校验）：一次全量返回 `{text 信封, revisions: [{revisionId, ordinal, body, transitionKind, revealedAt, scan?, detects[]}], myJudgments: [...], annotations: [...]}`——前端 `hydrateWorkspace(payload)` 重建全部流程状态（lineage/head/rev0/scans/detects/submittedScores/postSubmitted）。内网量小，不分页。
- **流式 partial**（拍板④）：`LlmFixJob` 加 `partial?: string`（累积输出）；`runLlmFixJob` 换流式模型调用逐 chunk 追加；GET job 响应 pending 时带 partial；前端等待期轮询 1s 显示流式预览面板（只读），done 后照旧 diff 并入审阅。evals 侧 `model-client` **新增**流式函数（gate/重试语义对齐；线 A 旧函数一字不动）；mimo 为 OpenAI 兼容 SSE，若现通道库不支持流式则按同 config 走原生 fetch 实现（申报）。
- **规则报告烘焙**：构建期新脚本（或扩 build-registry）把 `evals/report/report.json` 的 per-rule 全量统计烘为 `web/app/data/rules-report.json`（ruleId/verdict/effectiveLift/两侧命中与样本数等）；report 缺失优雅降级（空数据+页面注明）。规则本体（正则/说明/示例）从 registry 取，按 ruleId join。

### 热力图（拍板：挂版本，不挂草稿）

`MachineDetect.chunksJson` 坐标锚定该版 body——**只在「查看版本的只读正文」与报告 tab 缩略条渲染**（编辑态草稿坐标漂移，不叠层）。正文底色按块 P(AI) 梯度，与规则命中高亮用「底色 vs 下划线」区分，可开关。

### 报告 tab（需求 5）

检测进程 checklist（引擎扫描=同步✓ / 外部检测器=轮询态⏳→✓/不可用 / 「LLM 评价」灰色占位注明未接入）+ 多维卡（命中数、docScore、P(AI) 每检测器一行、热力缩略条）。**并列展示，不合成综合分**。

### 7a / 7b / 规则页

- **7a 按规则批量应用**（随 P1）：命中 tab 规则分组加「应用全部」（该规则全部命中批量 acceptIssueReplacement，坐标从后往前）+ 多选规则批量。
- **7b 校对批注**（P2）：ReviewEditor 行内建议层——可自动修复命中渲染为 ~~删除线原文~~+插入新文校对符，点击即应用；模式可开关；几百命中不卡。实现方案由执行 agent 侦察 ReviewEditor 装饰管线后定并申报。
- **规则页**（拍板⑤）：新 `/rules` 页 + 导航「规则」tab——表格（规则/说明/verdict 徽标/effectiveLift/两侧命中率）+ verdict 筛选 + 行展开详情（正则、review 文案、示例）。

## 工单拆分

| 工单 | 内容 | 依赖 |
|---|---|---|
| **P0-A 工作台骨架** | 状态机三态化、版本条+再次检测、左右布局（head 编辑器/旧版只读）、报告 tab（盲评卡+进程+多维卡+复评/D5 并入+完成出口）、命中 tab、引导条文案改写、阶段指示 | — |
| **P0-B 后端与数据地基** | 历史两端点、hydrate 契约、llm-fix 流式 partial（含 evals 流式函数）、规则报告烘焙 | —（与 P0-A 并行，零 app 文件） |
| **P1-C 工作台完形** | 历史列表入口+hydrateWorkspace 恢复、热力图两处、流式预览面板、7a 批量应用 | P0-A + P0-B |
| **P1-D 规则页** | /rules 页+导航+i18n（消费 P0-B 烘焙数据） | P0-B |
| **P2-E 校对批注** | ReviewEditor 行内建议层 7b | P0-A |
| 验证与文档 | 中期验证（采集点落位逐条核）+ 终验（真跑）+ 执行记录 | 各阶段 |

## Verification / Test

- 采集语义回归（重中之重）：按「采集点落位表」逐条 API 级验证——盲评 blind=true 先于揭示、复评 blind=false、improvementScore 校验、标注挂对版本、transitionKind 三态、D5 三口径。
- 工作台行为：版本切换只读/head 可编辑、再次检测建版+报告刷新、hydrate 恢复后状态与重建前一致。
- 流式：partial = 模型已吐出的**完整前缀**（服务端每 chunk 整段覆盖累积；**不保证单调追加**——模型层重试会回退变短重新累积，消费方必须整段覆盖、不得自行拼 delta）；done 后保留终值且 `result 文本 === partial.trim()`。（原「单调追加」措辞随 P0-B 实现契约修正，见执行记录。）
- 双 typecheck + vitest + bun test evals 全绿；浏览器验收清单另立（接 Task 13 的 35 步之后编号）。

## Implementation Walkthrough / 执行记录

> 2026-07-09 ultracode workflow 一轮跑完 P0-A / P0-B / P1-C / P1-D / P2-E 五工单 + 中期验证 + 修复轮 + 终验 + 链尾文档。数据模型零改动、线 A（repair.ts / callModelDetailed / repair-v1/v2/selection-v1）一字未动、真 eval.config.json 与 web/data.db 未动（md5 前后一致核验）。

### P0-A 工作台骨架（2026-07-09）

`contribute.vue` 从五屏向导重写为 **draft → workspace → done 三态**（1192 → 737 行），workspace 左右布局：左 = head 编辑器（**v-show 保活**——切旧版时草稿/diff/批注现场不丢）或旧版只读正文（AnnotatableRevisionText，标注挂该版 revisionId）；右 = 报告 tab（rev0 未揭示时独占盲评卡；揭示后进程 checklist + 多维卡 + rev_k 对比/复评四维/D5 + 完成出口）与命中 tab（FilterControls + IssueList 迁入，head 视图可应用替换）。版本条 = LineageStrip 可点击化包进 VersionBar，「再次检测」= 原 commitRevision 迁位重命名（草稿≠head 可用，成功追加版本条并刷新报告）。W7/W9 能力经新 composable `useLlmFixFlow` 无损迁入（diff 审阅横幅/stale/取消重试/选区改写/长文引导/外部 LLM 菜单，仅 head 编辑视图）。

**采集红线逐条保全**：盲评 POST 先于 reveal、复评在 reveal 后挂查看中的 rev_k、improvementScore 仅 rev_k、标注挂对 revisionId、transitionKind/provenance 照旧（user>llm>static）、D5 三口径由 `computeD5Legs` 单源（与 Task 13 verdict 屏一字不差）。

| 文件 | 改动 |
|---|---|
| `web/app/pages/contribute.vue` | 五屏向导重写为三态工作台（1192→737 行）；revisions 数组为唯一数据源 |
| `web/app/components/ReportPanel.vue` | **新**：报告 tab（盲评卡/进程 checklist/多维卡/复评四维/D5 三态/完成出口，不合成综合分） |
| `web/app/components/VersionBar.vue` | **新**：版本条 + 「再次检测」主按钮 |
| `web/app/components/LineageStrip.vue` | 可点击化：新增 `activeOrdinal?`/`clickable?` props + `select` emit |
| `web/app/components/FlowStepper.vue` | 五步节点退役，改三态阶段指示（纯展示） |
| `web/app/components/StepGuideBar.vue` | 四语境文案改写（draft/blind/workspace/viewing，zh/en） |
| `web/app/composables/useLlmFixFlow.ts` | **新**：W7 AI 改写全能力从页面抽出（发起/取消/重试/stale/选区/审阅导航） |
| `web/app/utils/contribute-workspace.ts` | **新**：共享数据形状 `WorkspaceRevision`/`BlindScores`/`PostJudgment` + 纯函数 `computeD5Legs`/`findDetectPair`/`pAiPercent` |
| `web/app/i18n/messages.ts` | 34 个新 key（zh+en）、25 个失效 key 删除 |

自验：双 typecheck exit 0 + vitest 101/101 全绿。

**与规格出入（申报）**：
1. ~~head（含 rev0 揭示后）无持久化 span 标注入口~~——按规格字面「点 head=编辑器」执行导致采集面收窄，**中期验证判为 Blocker 2，修复轮已补 head「只读标注」入口**（见验证轮记录）。
2. 离开 head 的「提示且不丢改动」= 编辑器 v-show 保活 + 切换瞬间 info 通知（draftKeptNotice），未做阻断式确认弹窗——规格允许选最小方案申报。
3. 版本条在 rev0 未揭示时整体隐藏（v-if=revealed）：盲评阶段显示「再次检测」会诱导偷跑，故藏。
4. 盲评两轴滑条从旧 draft 屏移入 ReportPanel 盲评卡；上传主 CTA 改为「上传并进入工作台」。
5. 复评目标从「恒 head」改为「当前查看的 rev_k」（对齐规格落位表）；每版 judgment 本会话提交一次后表单锁定展示已提交值，未保留重交入口（服务端 upsert 仍支持覆盖，解锁入口留拍板）。
6. AI 改写重试在查看旧版期间返回时仍并入保活的隐藏编辑器（editorActive 守卫按「工作台已揭示」而非「正在 head 视图」，避免白丢已跑完的结果）。
7. 本工单前次中断运行已产出 7 个文件（ReportPanel/VersionBar/useLlmFixFlow/contribute-workspace + 三组件改造），逐一精读复核与规格一致后采纳，本轮补齐 contribute.vue 重写与 i18n。

### P0-B 后端与数据地基（2026-07-09）

三块并行落地：① 历史列表 `GET /api/texts` 与工作台恢复 `GET /api/texts/:id/workspace`（owner 404 防枚举、未揭示 revision 机器数据置空守 D2、一次全量 hydrate 载荷，契约见「数据契约」节与端点文件注释）；② llm-fix 流式 partial——evals 侧新增 `callModelStreamDetailed`（原生 fetch 解析 OpenAI 兼容 SSE，复用同一 providerGate 限流 + callWithRetryDetailed/classifyOutcome 重试裁决），LlmFixJob 加 partial 累积字段、full/selection 双模式接流式、GET job 带出 partial；③ 规则报告烘焙——扩 `build-registry.ts` 同次构建烘出 `web/app/data/rules-report.json`（160 条 per-rule 全量统计按 effectiveLift 预排；report 缺失写空降级产物 `{source:null, rules:[]}`，两态实测）。

| 文件 | 改动 |
|---|---|
| `web/server/api/texts.get.ts` | **新**：历史列表（当前用户含匿名，createdAt 降序，preview=sourceNote 或正文压空白前 30 字，latestDocScore 未揭示恒 null 守 D2） |
| `web/server/api/texts/[id]/workspace.get.ts` | **新**：一次全量工作台载荷（text 信封 + revisions 升序 + myJudgments + annotations；revealedAt===null ⇒ scan 恒 null、detects 恒 []） |
| `evals/generator/model-client.ts` | **新增** `callModelStreamDetailed(resolved, system, user, maxTokens, onChunk?)` + `StreamChunkHandler`（仅 HTTP 通道；流中断抛错走重试，不返回截断文本；**线 A callModelDetailed 等旧路径一字未动**） |
| `web/server/utils/llm-fix.ts` | LlmFixJob 加 `partial` 累积（onChunk 每次整段覆盖），full/selection 双模式接流式 |
| `web/server/api/llm-fix-jobs/[id].get.ts` | 响应带 `partial: string \| null`（协议见「数据契约」拍板④补注） |
| `web/scripts/build-registry.ts` | 扩展同次烘出 rules-report.json（随 dev/build/generate/typecheck 链自动生成，gitignored） |

自验：仓根 typecheck、typecheck:server、bun test evals（44 pass）、流式真调 mimo 6 断言、端到端 API 真跑 37 断言全绿。

**partial 协议修正（对规格「单调追加」的实现出入，已写回 Verification 节）**：partial 语义 = 模型已吐出的**完整前缀**，服务端每 chunk 用累积全文整段覆盖；模型层重试（callWithRetryDetailed 语义）会使 partial 回退变短重新累积，故**不保证单调追加**——消费方 1s 轮询、每次整段替换（不是增量拼接）；done 后保留终值且 `result 文本 === partial.trim()`（已断言）。

**与规格出入（申报）**：
1. 流式实现走原生 fetch 解析 SSE（工单预留备选路径）：pi-ai `completeSimple` 非流式、其流式 API 是 agent 事件流，与本仓重试 seam 不匹配；请求体用经典 `max_tokens` 字段（mimo token-plan 只认它）。
2. `onChunk` 签名定为 `(delta, accumulated)`——accumulated=本 attempt 完整前缀，消费方整段覆盖即天然兼容重试回退。
3. 烘焙落在扩展 build-registry.ts 而非独立脚本（工单允许二选一）：report.json 本就在该脚本读取，四条链已挂，无需改 package.json。
4. workspace 端点 annotations/myJudgments 只回当前用户的（谱系 owner 私有实际等同全量；众评 per-user 揭示后置）。
5. workspace 端点未按字面复用 revisionMachineDto（逐版两次查询 N+1），改 prisma include 单次全量 + 内联映射（沿 export.get.ts 先例），DTO 类型复用 scan.ts。
6. `GET /api/texts` 未改 middleware：匿名会话触发面按 path 匹配天然命中（首访建匿名用户返回空列表）；`GET .../workspace` 不在触发面（无 session 时 handler 401），恢复流程总先经列表页故不构成死角——深链/刷新恢复留 TODO。

### P1-C 工作台完形（2026-07-09）

四项全部落地：**①历史与恢复**——draft 屏新增「我的检测历史」（ContributeHistoryPanel 消费 `GET /api/texts`，含匿名丢 Cookie 提示），点开经纯函数 `hydrateWorkspace(payload)` 按 P0-B 契约重建 revisions/revealed/盲评快照/复评/editDraft 直入 workspace，恢复后再次检测/复评/标注照常；**②热力图**——ReadOnlyHighlightedText 加 heat 层（块 P(AI) 绿→红梯度底色、命中改下划线区分、hover 显概率），只读视图头部开关记忆到 `settings.heatmap`，ReportPanel 多维卡每检测器行下加 DetectHeatStrip 缩略条，编辑态不叠（坐标漂移）；**③流式预览**——useLlmFixFlow 轮询收紧 1s 并把 `job.partial` 整段覆盖进 `llmFixStreamText`，LlmFixStreamPanel 在 AI 改写等待期只读渲染（整篇/选区都接，取消/重试并存）；**④7a 批量应用**——IssueCard 规则组「应用全部」+ 多选 checkbox + 底部「应用所选规则」，经 TextPanel 新 expose `acceptIssueReplacements` 从后往前批量并入（单通知单撤销）。

| 文件 | 改动 |
|---|---|
| `web/app/components/ContributeHistoryPanel.vue` | **新**：历史列表面板（preview/时间/版本数/docScore） |
| `web/app/utils/contribute-workspace.ts` | 新增 `hydrateWorkspace` 纯函数 + `TextHistoryItem`/`WorkspacePayload` 等契约类型 + `HeatChunk`/`heatColor` |
| `web/app/components/ReadOnlyHighlightedText.vue` | 新 prop `heat?: HeatChunk[] \| null`（非空=热力模式，缺省行为不变） |
| `web/app/components/AnnotatableRevisionText.vue` | 透传 heat |
| `web/app/components/DetectHeatStrip.vue` | **新**：报告卡热力缩略条（props=MachineDetect.chunks） |
| `web/app/components/LlmFixStreamPanel.vue` | **新**：流式只读预览面板 |
| `web/app/composables/useLlmFixFlow.ts` | 新返回 `llmFixStreamText`；轮询整篇/选区统一收紧 1s×420（≈7 分钟总时长不变） |
| `web/app/components/TextPanel.vue` | 新 expose `acceptIssueReplacements(issues): number`（mark 快照按 from 降序 splice，static+ruleId 溯源，实文校验跳过错位，单通知+单快照撤销） |
| `web/app/components/IssueList.vue` / `IssueCard.vue` | 批量应用 props/emits（apply-group / toggle-select） |
| `web/app/utils/review-issue-ui.ts` | 新导出 `isIssueAutoApplicable(issue)` |
| `web/app/utils/web-settings.ts` | 新增 `heatmap: boolean`（默认 true，normalize 已接） |
| `web/app/pages/contribute.vue` | 历史入口 + openHistoryText 恢复直入 workspace + 只读视图热力开关 |
| `web/app/i18n/messages.ts` | contribute.history*/heatmap*/llmStream*/batchApply* 等新 key，zh+en 齐 |

线 A、evals、server 零改动。

**与规格出入（申报）**：
1. 7a 未逐条循环调 acceptIssueReplacement（会逐条通知刷屏），改为整批单通知 + 单快照撤销；与后方替换重叠而错位的命中按实文校验跳过（cleanMechanical 同口径）。
2. 流式 1s 轮询未另起独立循环，把既有终态轮询 3s/1.5s 统一收紧为 1s（同一循环刷 partial），上限等比放大为 420 次。
3. 规则组「应用全部」仅在该规则可自动替换命中 ≥2 时显示（1 处时与行内单条按钮完全重复）。
4. 历史恢复加了规格未明写的残局兜底：head 已建但未揭示（上次「再次检测」在 reveal 前中断）→ reveal 幂等补拉；检测数据只对 head 与 rev0 缺失时补轮询，其余旧版不轮询（空=暂不可用如实展示）。
5. 匿名丢历史提示恒显（客户端无法可靠区分匿名/注册会话），未按登录态条件显示。

### P1-D 规则页（2026-07-09）

新增 `/rules` 页 + 表格组件：规则本体取 useLlmlint 已加载的 registry（303 条 regex 规则），按 ruleId join 构建期烘焙的 rules-report.json（160 条判别统计，effectiveLift 预排在前、未测规则按 ruleId 字典序殿后）。表格列 = 规则名称+ID / verdict 徽标（强判别·弱·噪声·反指标·数据不足·未测）/ effectiveLift / 人类率 / AI 率；支持 verdict chips 筛选（带计数）、文本搜索（ID/名称/说明/命名空间）、行展开详情（正则 targets、修复动作、示例、三维徽章、lift/prevLift/命中占比/命中数/配对明细）、50 条/页分页；report 降级态（source===null）页面注明评测数据缺失。

| 文件 | 改动 |
|---|---|
| `web/app/pages/rules.vue` | **新**：/rules 页（Nuxt 自动路由；join + 筛选 + 搜索 + 分页） |
| `web/app/components/RulesCatalogTable.vue` | **新**：表格组件（props={rows, hasReport}，展开态内部持有，复用 DimensionBadges 与 ruleDetail.* 文案） |
| `web/app/types.ts` | 导出 `RulesReportEntry` / `RulesReport` / `RuleCatalogRow`（RuleStat 单源 evals/lib/types.ts） |
| `web/app/components/AppHeader.vue` | 主导航「评测报告」后插入「规则」链接 |
| `web/app/i18n/messages.ts` | rules.* ×28 新 key（zh+en）+ header.rules 补 en |

自验：双 typecheck + vitest tests/ 全绿（本工单文件 0 错误）。

**与规格出入（申报）**：
1. verdict 徽标按 P0-B 契约真实值集（strong/weak/noise/anti/insufficient + 未测 join miss）；任务提示语中的「candidate」不在 RuleStat verdict 值集内，未采用。
2. 渲染性能选分页（50/页）而非虚拟化（303 行 + 行展开，虚拟化属过度）。
3. 规则表只列 registry regexRules（303 条）；llmRules（8 条）无正则扫描统计不入表。
4. `header.rules` 中文 key 已被先前构建预置，本单只补 en 覆盖与导航链接。

### P2-E 校对批注 7b（2026-07-09）

ReviewEditor **preview 模式**新增行内建议装饰层：可自动修复命中（replacement 非 null）渲染校对符号——替换型 = 原文删除线 + 行内绿色虚线建议文本（`<ins>` widget，截断 48 字、换行→↵），纯删除型 = 原文删除线 + 红色 × 角标；**点击符号即应用**（走 acceptReplacement 同语义 static splice，provenance/transitionKind 不变），点击原文仍为 caret-click 定位。开关默认开、偏好记忆于 `settings.proofreadMarks`，工具栏 preview 模式提供切换按钮（i-lucide-pencil-ruler）。校对开时容器加 `.is-proofread`，抑制 active 命中的 `::after` 建议复读，与命中底色/diff 绿底红删/批注下划线四层视觉互不冲突。

| 文件 | 改动 |
|---|---|
| `web/app/components/ReviewEditor.vue` | preview 装饰层校对符号 + `[data-proofread-issue-id]` 点击应用 + 工具栏开关 |
| `web/app/utils/web-settings.ts` | 新增 `proofreadMarks: boolean`（默认 true） |
| `web/app/i18n/messages.ts` | review.proofreadOnTitle / proofreadOffTitle / proofreadApplyHint（zh+en） |

**与规格出入（申报）**：
1. 方案按工单要求先量再选：实测现管线逐命中字符串定位 400 命中 × 40k 字 ≈ 17ms，校对层完全复用同循环已算好的 range（零额外扫描）→ 选**装饰扩展**；叠加层需数百次 getBoundingClientRect + 编辑/滚动持续重定位，被否。
2. 仅 preview 模式生效：source 模式是 textarea+镜像叠加层，行内插入建议文本必然破坏镜像坐标对齐，且点击=光标定位语义与「点击即应用」冲突；开关也只在 preview 模式显示。
3. 点击语义细化：点击校对符号应用、点击被删除线标注的原文保持定位——避免正文误触即改稿。
4. 「纯插入」符号：现扫描器命中恒有 match（to≥from+1），纯插入型实际不产出；仍实现了该退化分支以备规则形态扩展。

### 验证轮记录

**中期验证（run=true / spec=false）**：运行断言 42/42 全绿（采集语义 20 + 新端点 11 + 流式真调 11）+ rules-report schema 断言 11/11 + 降级/恢复两态实测通过；静态：仓根 tsc exit 0、web typecheck exit 0、typecheck:server exit 0、vitest tests/ 101/101（3 文件）、bun test evals 44/44（124 expect）；`data.db` 与 `eval.config.json` md5 前后一致；隔离库已删、3012 端口已释放。spec=false 源于两个 blocker，随即修复：

- **Blocker 1（证实并修复）跨篇 AI 改写状态泄漏**：原 resetFlow 只推进 detectEpoch/resetReviewState，useLlmFixFlow 的取消令牌独立；ReportPanel「完成本篇」无运行守卫。修复三点——① useLlmFixFlow 新导出 `abandonAll()`（推进 llmFixGeneration + 复位运行态），resetFlow 改调之，在途轮询下个醒来点静默退出，A 篇结果不并入不转 stale；② ReportPanel 增必填 prop `llmFixRunning`，「完成本篇」运行期禁用（对齐 W7 F1 离场纪律）；③ 重试闭包携带发起时 textId 快照，跨篇不匹配即忽略。
- **Blocker 2（证实并修复，采纳候选①）单 rev0 会话揭示后 head 无持久化 span 标注入口**：核实 `POST /api/annotations` 唯一前端调用方是 AnnotatableRevisionText，原 `editorVisible=revealed&&isHeadView` 使揭示后的 head 永无只读视图。修复：新增 `headReadOnly` ref + head 编辑工具行「只读标注」按钮（i-lucide-highlighter）切只读正文——标注挂 head.revisionId、坐标锚落库 body（非脏草稿）；「返回编辑」/点 head chip/再次检测均重置 headReadOnly=false 保拍板②「点 head=编辑器」；命中 tab/引导条改按 editorVisible 联动。
- 修复自验：仓根 tsc exit 0、web vue-tsc exit 0、vitest tests/ 101/101。

**终验（run=true / spec=true）**：终验脚本断言 **66/66** 通过（A 规则页一致性 9 + B 纯函数口径 2 + C 端到端 55）。静态全家：仓根 tsc exit 0、web typecheck exit 0、typecheck:server exit 0、vitest tests/ 104/104（4 文件，1.56s；较中期多出的 3 个来自并行工单期间新增，全过）、bun test evals 44/44。运行数据：7a 批量应用 21 处/11 规则、引擎命中 49→4；外部检测器三版各落 1 条（detect 通道真跑通）；流式 partial 观测 2 次递增（38→165）；整篇+选区 mimo job 均 done 无错。终验脚本首轮失败一次系测试选材问题（top-3 规则组命中 span 完全重叠，实文校验后只剩 1 组），改全组多选后按预期跨 11 规则应用——恰好实证了重叠跳过语义正确，非产品缺陷。

**链尾全量回归（2026-07-09 本环节复跑）**：仓根 tsc exit 0；web typecheck (vue-tsc) exit 0（registry 303 regex + 8 llm、311/340 active、engine 2.0.0+r40d8072a、verdict 烘焙 160 条 strong 7；rules-report.json 160 条统计，样本 human 26 / ai 100）；web typecheck:server exit 0；vitest run tests/ = **104/104** 通过（4 文件，1.54s）；bun test evals = **44/44** 通过（124 expect，6 文件）。

**未解决 blocker：无。**

**观察项（验证轮 minor 合集，非阻塞；可行动项已收进 TODO）**：

- 测试口径如实记法：**vitest 104 tests pass（tests/ 4 文件）；evals 由 bun test 覆盖（44 pass）**——全仓 `bun run test`（vitest 不带路径）下 evals/ 的 6 个 bun:test 文件收集失败（`Cannot find package 'bun:test'`）为双运行时预存现状（Task 13 F1 已登记），非本任务引入；建议 vitest 配置 exclude `evals/**` 一劳永逸。
- head chip 点击死区：head 只读标注模式下点版本条 head chip 无效——`selectVersion` 在 `ordinal === activeOrdinal` 时提前 return，走不到 `headReadOnly=false`；有「返回编辑」按钮兜底不构成死锁，修法=提前 return 条件放宽为 `ordinal === activeOrdinal && !headReadOnly`。
- commitRevision 两步链（POST /api/revisions 成功 → reveal 失败）时新版已落库但前端未追加，下次再次检测 parent 取旧 head → 服务端静默分叉（ordinal 单调不复用不报错）；Task 13 既有两步模式沿袭。
- 旧版只读视图命中 tab：IssueCard「替换/删除」按钮无条件渲染、点击静默无效——建议加 readonly prop 隐藏应用列。
- AI 改写运行中切旧版视图后「取消」按钮随 v-show 隐藏（在 head 容器内），取消入口需切回 head 才可达——与 editorActive 口径自洽，仅记录。
- useLlmFixFlow / pollDetects 无 onUnmounted 清理：等待期直接导航离开 contribute 页，1s 轮询最长再跑 ≈7 分钟（三重守卫保证无状态污染，只浪费请求）。
- D5 机器腿在终验测试数据下 machineLegPass=false（批量修复后 docPAi 未降，尽管命中 49→4）——数据相关现象，断言目标是 live/hydrate 两侧口径一致（通过），非门槛判定。
- 流式 pending 期仅采到 2–3 个样本（测试正文短、mimo 吐字快，刚好满足 ≥2 次递增门槛）；重试回退分支未观测（需模拟 provider 故障），前端整段覆盖消费天然兼容。
- 外部检测器（HF）中期按 D5 降级口径验证（detects 空数组形状已核），detectPair 升级口径在终验端到端补齐（三版各 1 条）。
- i18n：本任务全部新 key zh+en 双语齐、used-but-undefined=0、无死 key 引入；存量债=死 key ×10（issue.applyTitle/locateTitle 疑为 7a 换 key 后孤儿，余为更早遗留）+ enUS 覆盖缺口 ×23（about.* 等英文界面显示中文）+ resolveApiErrorMessage fallback 硬编码英文两处——均非本轮引入。
- openHistoryText 恢复覆盖了全部核心状态但沿用上一篇的 editScanAll 开关值（resetFlow 会重置它）——偏好性残留，无害。
- contribute.vue 与 ReportPanel 用 Tailwind 调色板类做状态色——llmlint web 仓既有风格，与其余页面一致，未动。
- 验证脚本 `web/.agent/workspace/t15-mid-verify.ts` 保留供复跑；临时 dev server 日志已删。
- web/package.json 的 `build:report`（report.json → public，评测报告页产物）与 build-registry 内烘焙 rules-report.json 并存、职责不同无冲突；注意 typecheck 链只跑 build-registry——「随四条链自动生成」在 typecheck 一环仅对 rules-report.json 成立。

## 浏览器验收清单（接 Task 13 的 35 步，从 36 起）

36. **工作台合并（盲评闸门 UI）**：上传正文 →「上传并进入工作台」→ 直入 workspace（顶栏阶段指示=工作台）；右侧报告 tab 独占盲评卡、命中 tab 禁用、版本条不出现、左侧无编辑器/无任何机器结果——D2 不偷跑。
37. **盲评卡**：两轴打分提交（或跳过）→ 揭示：报告 tab 变为进程 checklist + 多维卡，左侧出现 head 编辑器（规则命中高亮），版本条出现（rev0 当前）。
38. **报告 tab 进程与多维卡**：checklist 引擎扫描立即 ✓、外部检测器 ⏳ 轮询转 ✓（或「暂不可用」）、「LLM 评价」灰色占位注明未接入；多维卡=命中分级 + docScore + 每检测器 P(AI) 一行 + 热力缩略条（DetectHeatStrip），无合成综合分。
39. **版本切换与草稿保活**：在编辑器改几处（不提交）→ 点 rev0 chip → 左=该版只读正文 + 右=该版报告，同时出现「草稿已保留」info 通知 → 点回 head chip → 编辑器带着刚才的改动回来（diff/批注现场不丢）。
40. **再次检测**：草稿≠head 时版本条按钮可用（AI 改写等待期禁用）→ 点击 → 版本条追加 rev_k 并选中、报告 tab 刷新为该版：与 rev0 对比 + 复评四维 + D5 三态；提交复评 → 表单锁定展示已提交值、D5 出现。
41. **head 只读标注**：head 编辑视图工具行「只读标注」→ 切只读正文，选中文字可保存持久化 span 标注（挂 head 落库 body）；「返回编辑」回编辑器；旧版只读视图同样可标注（挂该版）。
42. **完成出口**：报告 tab「完成本篇」（AI 改写运行中禁用并注明）→ done 屏总结卡（annotated/judged 计数正确）。
43. **历史恢复**：回 draft 屏「我的检测历史」列表（preview/时间/版本数/docScore——未揭示的显示空 docScore）→ 点开一篇 → 直入 workspace：版本条/各版报告/已提交盲评与复评（锁定态）/标注计数与离开时一致；恢复后再次检测/复评/标注照常可用。
44. **热力图开关**：查看已揭示版本的只读正文 → 头部热力开关（默认开）→ 正文块底色绿→红梯度、hover 显 P(AI)%、规则命中改为下划线；关闭后回命中底色；刷新页面偏好记忆。
45. **流式预览**：发起 AI 改写（整篇或选区）→ 等待期左栏出现只读流式预览面板、文本逐秒增长（重试时可能回退变短重来，属预期）；完成后照旧进 diff 审阅横幅；「取消改写」与失败「重试」并存可用。
46. **7a 批量应用**：命中 tab（head 编辑视图）规则组头部「应用全部」（该组可替换命中 ≥2 时出现）→ 一次并入全部替换、单条通知、一次撤销回退整批；勾选多个规则 → 底部「应用所选规则」跨组批量同语义。
47. **校对批注（7b）**：编辑器 preview 模式工具栏校对开关（默认开）→ 可自动修复命中显示原文删除线 + 行内绿色建议文本（纯删除=红 × 角标）→ 点击建议符号即应用该替换（与单条「替换」按钮同结果）；点击删除线原文只定位不应用；关闭开关恢复原高亮；刷新偏好记忆；source 模式无校对层与开关。
48. **规则页**：导航「规则」→ /rules：303 条规则表格、有统计的按 effectiveLift 预排在前；verdict chips 筛选（带计数）、搜索（ID/名称/说明/命名空间）、行展开详情（正则 targets/示例/lift/配对明细）、50 条/页分页翻页正常。
49. **i18n**：切英文复走 36–48 主动线——工作台/历史/热力/流式/批量/校对/规则页全部新文案有英文（about.* 等 23 个存量 key 显示中文为已知遗留，不算本任务失败项）。

## TODO / Follow-ups

- [x] P0/P1/P2 按工单表推进（ultracode workflow，2026-07-09 启动）——**P0-A/P0-B/P1-C/P1-D/P2-E 全部完成**，中期+终验+修复轮全绿、未解决 blocker 无（见执行记录）
- [ ] **浏览器验收 36–49 待用户**（见上「浏览器验收清单」）

**验证轮登记的可行动项（均非阻塞）**：

- [ ] head chip 点击死区：`selectVersion`（contribute.vue）提前 return 条件放宽为 `ordinal === activeOrdinal && !headReadOnly`，让 head 只读标注模式下点 head chip 也能回编辑器（现有「返回编辑」按钮兜底）
- [ ] 旧版只读视图命中 tab 给 IssueList/IssueCard 加 readonly prop，隐藏静默无效的「替换/删除」按钮
- [ ] commitRevision 两步链（建版成功→reveal 失败）前端未追加 revisions → 下次提交静默分叉（Task 13 沿袭）；catch 里区分「已建版但揭示失败」给重试拉取
- [ ] `GET /api/texts/:id/workspace` 不在匿名会话触发面（无 session 直达 401）：若要支持工作台深链/刷新恢复，纳入触发面或前端兜底跳列表页
- [ ] `GET /api/texts` 在匿名触发面 → 任意无 cookie GET（爬虫/健康检查）建匿名 user 行——内网可接受，公网部署前随 Task 13「触发面按 path 不按 method」项一起收紧
- [ ] 复评每版提交一次后锁定、无重交入口（服务端 upsert 仍支持整行覆盖）——是否加解锁入口，用户拍板
- [ ] useLlmFixFlow / pollDetects 加 onBeforeUnmount 推进代数令牌，消除离开 /contribute 路由后的轮询残留（最长 ≈7 分钟空转请求，无状态污染）
- [ ] vitest 配置 exclude `evals/**`，让全仓 `bun run test` 不再因 bun:test 文件收集失败报红（双运行时预存现状）
- [ ] i18n 存量清理：死 key ×10、enUS 覆盖缺口 ×23、resolveApiErrorMessage fallback 硬编码英文两处（均非本任务引入）
- [ ] openHistoryText 恢复时顺手重置 editScanAll（偏好性残留，无害）

**后置（拍板明确不做）**：

- [ ] 从旧版本分叉编辑、全站共享历史、SSE 推送、ReAct agent 化 LLM 修复、LlmJudgment 真接入（报告卡先占位）

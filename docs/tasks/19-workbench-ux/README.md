# 检测工作台整体 UX 优化

> Task 19：用户看 Task 15-18 累积后的工作台截图反馈「整体 UX 太烂了」（2026-07-10）。
> 上游：[Task 18](../18-agent-rewrite/README.md)、[Task 17](../17-workbench-round2/README.md)。

## User Request + 拍板

四方向全做：①信息架构重排 ②文案说人话 ③视觉层级打磨 ④分栏可拖拽。优先级交给执行方判断。
**拍板（勿重议）**：工作台内隐藏旧「一键清理」按钮（与静态修复语义重叠，playground 保留）；按钮新文案「机械修复（N）」「一键修到底」。**本轮浏览器验证由用户自行执行**（用户明示）。

## 工单与实施

**A 左栏工具区归并**（contribute.vue + TextPanel.vue，主循环）：
- TextPanel 工具条加 `<slot name="toolbar-leading" />`；contribute.vue 把「机械修复/一键修到底」两按钮经 slot 注入（状态留宿主，零 props/emit 搬迁）；原独立按钮行 + D-D 说明行整块删除，口径说明白话化后拼进机械修复按钮 title。
- embedded 模式隐藏旧 cleanMechanical（`v-if="autoFixCount && !embedded"`）。
- 工具条统一口径：容器 text-sm→text-xs、py-2→py-1.5；命中导航器 h-8→h-7（按钮 w-8→w-7）；repair-draft-status 胶囊 min-height 2rem→1.75rem。

**B ReportPanel 分组 + 术语说人话**（agent 执行，ReportPanel.vue + messages.ts）：
- 揭示后重排三区块：结论主卡（盲评回显并入顶部注脚 + 色环 + 白话汇总 + 检测进程收进卡底 border-t）→「详细数据」`<details open>` 折叠组（分项指标/LLM 评审降为 bg-subtle 无边框子卡）→ 行动区（k≥1，「和原文比怎么样」分组标题下对比/复评/验收结论）。所有 v-if 渲染条件（D2 闸门/rev_k）逐条原样。
- 文案改 value 不改 key（zh/en）：blindSkippedTitle→「本篇未做初读打分…」、metricsTitle→「详细数据（第 N 版）」、compareWithRev0 去 rev0、docScoreRow→「每千字命中」、verdict* 全说人话（「✓ 验收通过：AI 概率降了，读者缘没掉」等）、strongFixScope/Degraded 白话、staticFixButton→「机械修复」、oneClickFixButton→「一键修到底」；顺手改 blindReviewSavedTitle→「初读打分：」等 7 处裸术语。新增 key：`contribute.actionGroupTitle`。

**C 顶部压缩 + 视觉口径**（主循环）：
- StepGuideBar 从独占一行改为内联进顶栏行尾（contribute.vue 顶栏 flex 内，`basis-full md:ml-auto md:basis-auto md:max-w-[40%]`）；**默认折叠**（无 localStorage 记录时折叠，折叠态=单个罗盘按钮、title 带完整引导句）。宽屏顶部压到单行。
- 口径统一：右栏 tab 条 / 命中统计行 / 批量工具条 / 只读标题行 text-sm→text-xs，gap-3→gap-2。

**D 分栏可拖拽**（主循环，照 playground 先例复制不抽组件）：
- web-settings 三处新增 `contributeReportWidth`（默认 560，normalize 360-960）。
- main `grid md:grid-cols-2` → `flex flex-col md:flex-row`；左栏 flex-1 min-w-0（原 md:border-r 分隔线职责移交手柄）；中间 `.contribute-resize-handle`（拖拽 + 方向键/Home/End 键盘微调 + aria）；右栏 md 定宽 `:style`；窄屏 <768px 手柄隐藏、保持上下堆叠。i18n 复用 `layout.resizeReportPanelTitle`。

## Verification / Test

- web typecheck + typecheck:server 双 0 错误；vitest 124/124；bun test evals 未涉后端零动。
- 纯模板/样式/文案/slot + settings 一个新字段；useLlmFixFlow / 数据流 / TextPanel expose 面 / ReviewEditor 零改动。
- **浏览器验收由用户执行**，走查点：
  75. 顶部单行（stepper+版本条+折叠引导罗盘）；点罗盘展开引导句。
  76. 编辑器工具行：机械修复（N）/一键修到底在行首，全行 h-7/text-xs 齐平；旧「一键清理」不再出现（playground 仍在）。
  77. 报告 tab 三区块：结论主卡含初读打分注脚与进程注脚；「详细数据」可折叠；无 rev0/D-D/D5/docScore 裸术语。
  78. 拖拽手柄改宽 → 刷新保持；键盘方向键微调；窄屏无手柄上下堆叠。
  79. 英文界面全线。

## TODO / Follow-ups

- [ ] 用户浏览器验收 75-79
- [ ] 手柄样式与 playground 重复 ~40 行，两处都稳定后可抽 ResizeHandle 共用组件
- [ ] 命中列表 tab 内三行小工具（统计/Filter/批量）本轮只统一字号，进一步合并另议

# Round 05 — 架构优化：报告表现层迁到 web + 模型客户端可靠性加深（2026-07-01）

> 起因：`/improve-codebase-architecture` 复盘出两处摩擦，用户点两题落地。计划：`~/.claude/plans/m1-acquisition-elegant-goblet.md`（round-05 稿，已审批）。全部在 sibling `llmlint/`。

## 起因（两处架构摩擦）

1. **表现层长错了地方**：`score.ts` 自产 json + md + **html**，其中 `report-html.ts` 是 ~400 行手搓 HTML/CSS/vanilla-JS，重实现排序/筛选/色码/条形——而这些 `web/`（Nuxt4+Vue+UnoCSS+color-mode）本就免费提供。评测 harness 是**度量生产者**，不该拥有表现层；`web` 已有「预烘 JSON→Vue」范式（`registry.json`）可复用。
2. **模型客户端太浅**：`callModel → string` 罩着不稳的依赖却只有墙钟超时、**无重试**，空/拒答静默变 `""`。round-04 doubao 3/10 render 空输出被跳过、**既不重试也不解释**。

## 决策（用户拍板）
- 报告投喂 = **上传/拖拽**（客户端读 json，不预烘、不耦合）；evals **只产 json**（删 md+html）；web **启用 Nuxt 路由**。

## 改了什么

### A. 报告表现层迁到 web
- **evals 瘦身**：删 `lib/report-html.ts`；`lib/report.ts` 删 `renderMarkdown` 只留 `buildReport`；`score.ts` 只写 `report.json`（终端摘要保留）。`Report` 契约留 `lib/types.ts`。
- **web 报告页**：`app.vue`→`<NuxtPage/>` 壳（启用 pages 路由），原 playground 移 `pages/index.vue`；新 `pages/report.vue`（拖入 json）+ `composables/useReport.ts`（排序/筛选/搜索状态）+ 组件 `ReportDrop`/`ReportDetectorCard`/`ReportModelRanking`/`ReportHoldoutCard`/`ReportRuleTable`（照现有 `<script setup>` + UnoCSS + color-mode 约定）。`AppHeader` 加 playground↔report 导航、registry 变可选。
- **类型共享不污染 skill**：`nuxt.config.ts` 加 alias `evals`→`../evals/lib`；`app/report-types.ts` `import type {Report,...} from "evals/types"`（构建期擦除、无运行时耦合）。
- **坑（vue-tsc 崩）**：启用 pages 后 Nuxt4.3 往 `.nuxt/tsconfig` 写 `vue-router/volar/sfc-route-blocks`，但 vue-router4.6 已删该子路径 → vue-tsc 加载失败崩溃。`web/tsconfig.json` 覆写 `vueCompilerOptions.plugins:[]` 修好（不用 `<route>` 块，`web/tsconfig` 不被 prepare 重写故持久）。

### B. model-client 可靠性加深（`generator/model-client.ts`）
- **原生 abort/重试替代 Promise.race**：`completeSimple` 传 `signal: AbortSignal.timeout(min(timeoutMs,240s))` + `maxRetries` + `maxRetryDelayMs`（真正 abort fetch）；留薄墙钟兜底。
- **classify + retry seam**：纯函数 `classifyOutcome(assistant|error) → ok|retry|terminal`（context 溢出/鉴权/未激活/拒答 = terminal；429/5xx/超时/网络/瞬时空 = retry）；`callWithRetry(attempt, …, sleepFn)` 重试循环（注入假 attempt/sleepFn 即无网单测）。终态/耗尽抛带原因错 → 调用方日志打「为什么」。
- **新单测** `generator/model-client.test.ts`：classifyOutcome 各分支 + 重试循环（空一次→成功只重试一次、terminal 立即抛、耗尽后抛）。

## 关键发现：doubao 空输出真因（新诊断当场抓到）
重跑填 round-04 的 3 个 doubao 空缺，日志立刻显形：
```
doubao render-0004 ← 2 字（ref 3396）
↻ 重试 1/2（empty-output: stopReason=length, output_tokens=8000）
```
`doubao-seed-2-1-pro` 是**推理模型**：render 的 8000 maxTokens 被 thinking 烧光、`stopReason=length` 截断，`extractText` 只留 text block → 可见正文≈0。**非内容过滤/限流，是 token 预算耗尽**。
- **根因修复**：render `maxTokens` 8000 → **16000**（给推理模型思考完还能写整章的余量；非推理模型不受影响）。实测 lotm-0001 从空 → **3237 字**。
- **分类细化**：`length`+空 = **terminal**（重试同参数无益，提示调大 maxTokens/关推理）；`stop`+空 = retry（瞬时）。

## 验证
- **evals**：`bun test`（metrics + model-client）**17/17**；`bun run typecheck` 0 错；`score.ts` 只产 `report.json`。
- **web**：`vue-tsc` exit 0（含用户增强后的 index.vue）；`nuxt build` client+server 均通过；`bunx nuxi prepare` OK。
- **可靠性实跑**：doubao 16000 后正常出章（3237 字）；一次慢调用触 240s 墙钟 → 重试（非卡死）。
- 浏览器版式验证：按 CLAUDE.md 未自动做，建议用户 `cd web && bun run dev` 打开 `/report` 拖入 `evals/report/report.json` 核对。

## 计划出入 / 局限
- report-html 的交互（排序/筛选/搜索）在 Vue 版全部保留并更顺手（响应式而非手搓 JS）。
- doubao 16000 后偶发 >240s（推理久），靠墙钟+重试兜；若频繁需再上调 cap 或换非推理 doubao 变体。
- 本轮为验证只补跑了部分 doubao 空缺（`timeout` 截断）；完整 `generate.ts` 跑一遍即可用 16000 预算补齐全部 doubao 覆盖。

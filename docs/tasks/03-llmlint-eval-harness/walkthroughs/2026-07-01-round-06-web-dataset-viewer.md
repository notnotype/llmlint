# Round 06 — web 数据集查看器（样本浏览 + 参考↔演绎并排高亮）（2026-07-01）

> 起因：用户问「report 页能不能看到数据集」。计划：`~/.claude/plans/m1-acquisition-elegant-goblet.md`（round-06 稿，已审批）。

## 决策（用户确认）
- 视图 = 单篇浏览+高亮 **+** 参考↔演绎并排对比。
- 数据投喂 = evals 产 `dataset.json`（正文+meta）本地拖入。
- 公开部署 = 本地专用；数据集**不进 public**（只有指标 `report.json` 可公开 bake）。

## 为什么好做（复用）
浏览器已装完整 llmlint 引擎（`registry.json` + `scanText`，`useLlmlint`）——`scan(text)`+`issueRanges()` 对**任意正文**本地算高亮，与 playground 同一套。corpus 仅 541K。所以「样本 + AI 味高亮」几乎全复用。

## 改了什么

### A. evals 产 dataset.json
- **新 `evals/dataset.ts`**：`loadCorpus` → 精简样本（去 absPath）→ 写 `evals/report/dataset.json`（不 scan，高亮浏览器现算）。`Dataset`/`DatasetSample` 加进 `lib/types.ts`。产物 38 样本、~394KB，落在已 gitignore 的 `report/`（不进 git/public）。

### B. web 数据集查看器（`/dataset` 路由）
- **`ReadOnlyHighlightedText.vue`**：复用 `HighlightedTextarea` 的分段高亮逻辑，只读（`<div>` 取代 textarea、无 v-model）；CSS 主题变量。
- **`useDataset.ts`**：拖入 `dataset.json`（照 `useReport.loadFile`）→ 按 genre/plotId/章（reference 文件为键，render 按 `pairRef` 挂章）组织成树。
- **`pages/dataset.vue`**：左树选章 + 两模式：**并排对比**（左 reference / 右 render 可选模型，两侧高亮 + 命中计数）、**单篇浏览**（选样本 → 正文高亮 + 复用 `IssueList` 命中卡）。复用 `FilterControls`（共享受众/级别/命名空间过滤，`scanAll:true` 对齐 evals 不遮罩）。
- **`DatasetDrop.vue`**（CSS 变量主题 + 版权警告）、`dataset-types.ts`（re-export `Dataset` via `evals` alias 只 `import type`）、`AppHeader` 加「数据集」导航 + i18n `header.dataset`（zh/en）。

## 版权守门
- `dataset.json` 只本地拖入；`web/public/` 只有 `report.json`（指标、安全），**无 dataset.json**；`/dataset` **无「加载内置示例」**（不像 /report 会 fetch public/report.json）；`build-report.ts` 只拷 report.json。→ 公开 GitHub Pages 站不含任何版权正文。

## 验证
- evals：`bun evals/dataset.ts` 产 38 样本 dataset.json；`git check-ignore` 确认 IGNORED；`bun run typecheck` 0 错。
- web：`bunx nuxi prepare` + `vue-tsc` **exit 0**；`nuxt build` client+server 通过（219 modules）。
- 守门：`web/public/` 仅 report.json；dataset 视图无 public/fetch。
- 浏览器版式（按 CLAUDE.md 未自动做）：建议 `cd web && bun run dev` 打开 `/dataset` 拖入 `evals/report/dataset.json` → 选章看并排对比（AI 侧高亮扎堆 vs 人类侧干净）、切单篇 + 命中卡、切过滤实时重算。

## 不做（范围外）
- 规则下钻（点规则→跳命中样本，用户未选）；目录上传（webkitdirectory）；同步滚动；数据集查看器 UI 文案 i18n（现走硬编码中文，与 report 组件一致，后续可统一）。

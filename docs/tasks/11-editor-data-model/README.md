# 编辑器数据模型重设计：收敛到单一坐标权威

> 接 [Task 07](../07-web-review-editor/README.md)（编辑器）/ [Task 09](../09-web-revision-persistence/README.md)（piece-table 地基）/ [Task 10](../10-repair-flow-ux/README.md)（改文流程 UX）。
> 权威规范：[CONTEXT.md §2.6](../../../CONTEXT.md#26-修订与修复web-编辑--持久侧task-09)（修订 / 修复草稿术语）。
> 相关文件：`web/app/utils/repair-draft.ts`、`web/app/utils/review-ranges.ts`、`web/app/utils/review-comment-storage.ts`、`web/app/components/TextPanel.vue`、`web/app/components/ReviewEditor.vue`、`web/app/components/HighlightedTextarea.vue`。

## Relative documents refs

- [Task 07 web-review-editor](../07-web-review-editor/README.md) — 编辑器（TextPanel / ReviewEditor / HighlightedTextarea）本体
- [Task 09 web-revision-persistence](../09-web-revision-persistence/README.md) — RepairDraft piece-table 纯核心 + N 版本落库
- [Task 10 repair-flow-ux](../10-repair-flow-ux/README.md) — 改文流程接入编辑面 + 打字 burst 合并

## User Request / Topic

用户实测改文流程后要求：**先修复、重构编辑器，重新设计编辑器的数据模型**。
配套三点观察（见 Task 10 审查 + 本轮 playwright 复审）：timeline/位置感缺失、编辑器仍有 bug、流程很多地方藏起来（引导差，例如修订版本要改一次才看得到）。本任务只收「编辑器数据模型」这一层；timeline / 版本可见 / 流程引导另计。

## Goal

> 把编辑器从**四套并存的坐标锚定系统**收敛成**单一坐标权威**：一切锚定不可变原文坐标，草稿坐标一律由 piece-table 现算派生；「建议」与「已应用编辑」在模型上显式分层；删除迁移后遗留的命令式搬运死代码。
>
> - **Verification**：`repair-draft.test.ts` 覆盖新批注模型；playwright 复跑改文——批注不再随打字漂移、建议预览不再伪装成已应用改动、连续打字仍只成一处编辑。
> - **Constraints**：不破 Task 09 的 piece-table 单一派生模型与 N 版本落库；不破 D2/D5。
> - **Boundaries**：只动 `web/` 编辑器栈 + 其纯核心测试。

## Diagnosis：四套锚定系统（问题根因）

实读编辑器全栈后确认，编辑器的位置态分散在四套互不一致的系统里：

1. **piece-table（`RepairPlan`）** — `repair-draft.ts`。源锚定 edit，draft/diff 全派生。**干净、精确、有测**。是唯一「对」的模型。
2. **批注（`ReviewComment[]`）** — `TextPanel.comments`。锚在**当前草稿坐标**，每次文本变动经 `transformReviewCommentsForTextChange` 命令式单-diff 平移。**独立第二套坐标系、易漂移**，且 localStorage 按草稿文本 key 持久。
3. **命中标记（`ReviewIssueMark[]`）** — 每次从 scan 结果在草稿上重建。第三种表示；auto-fix 替换预览（`replacement`）出自这里。
4. **预览装饰** — `ReviewEditor` 预览模式用 `indexOf`/`nearestIndex` **模糊文本匹配**把原文 offset 映射到 ProseMirror 位置（`locateSourceRangeInPreview`）。**不是按 offset**，重复子串 / markdown 渲染差异即错位或丢装饰。

**bug 溯源**：
- 绿色「→ 这是」浮标 + 「未修改」却显示删除线 = 建议预览（系统 2/3 的 `replacementRanges`）与已应用 diff 画在同一视觉层，且 `HighlightedTextarea.vue` CSS 用 `top:-0.78em; left:100%` 把标签顶到上一行 → 看着像错位浮标、像已改。**模型层根因：建议与已应用编辑无显式分层**。
- 批注漂移 = 系统 2 的命令式搬运弱于 piece-table。
- 命中口径 7 vs 19 = 同一文本多份派生视图、过滤不一致（contribute.vue 层，另计）。

## Redesign：单一坐标权威

**原则：一切锚定不可变原文坐标；草稿坐标一律由 plan 派生。piece-table 成为唯一位置映射权威。**

- **批注 → 源锚定**（消灭系统 2）。批注锚 `sourceFrom/sourceTo`（不可变），草稿坐标 = 投影现算。原文不可变故锚点天然稳定；edit 落在批注区间内 → 投影 `stale`，UI 提示「原句已改」。对 llmlint「标注原文哪里差」的采集语义也更正确。
- **建议与已应用编辑显式分层**（消灭绿浮标混淆）。已应用编辑 = `RepairPlan.edits` → diff（在草稿里）；建议 = scan 派生，**按需显示**：正文不常驻画未应用替换，替换文本可供性收敛到工具条按钮 + 选区菜单 + IssueCard。
- **删死代码**：命令式搬运（comment/diff transform）、`repairDiffs` prop、`sourceRepairDiffs`。
- **（岔路）预览精确映射**：`indexOf` 模糊匹配 → 精确 offset 映射。大且风险高，**已拍板延后为独立任务**。

## Staged plan

| 阶段 | 内容 | 文件 | 状态 |
|---|---|---|---|
| **S1** | 纯核心新增源锚定批注模型 + 映射 + 测试 | `repair-draft.ts`、`repair-draft.test.ts` | ✅ |
| **S2** | `TextPanel` 批注迁到源锚定，删 `transformReviewCommentsForTextChange` 三处调用 + undo 快照简化 + 持久化按原文 key（v2） | `TextPanel.vue`、`review-ranges.ts`、`review-comment-storage.ts`、`useRecentScans.ts` | ✅ |
| **S3** | 建议 vs 已应用编辑分层渲染：建议按需显示（修绿浮标 + 「未修改」矛盾） | `HighlightedTextarea.vue`、`ReviewEditor.vue` | ✅ |
| **S4** | 删死代码（命令式 diff 搬运、`repairDiffs` prop、`applyIssueReplacement`、相应旧测试） | `review-ranges.ts`、`ReviewEditor.vue`、`TextPanel.vue`、`llmlint.test.ts` | ✅ |
| **S5**（岔路） | 预览精确 offset 映射 | `ReviewEditor.vue` | ↩ 延后为独立任务 |

## Decisions

- **批注是否源锚定**：✅ 采用。理由：消除独立坐标系、对采集语义更正确。
- **S3 建议显示方式**：✅ 用户拍板**按需**——非 active 命中只保留命中底色，替换预览文本只出现在工具条按钮、选区菜单、IssueCard；active 命中在正文只画定位轮廓。
- **S5 预览模糊匹配**：✅ 用户拍板**延后**——ReviewEditor 近 3000 行、风险高，源码模式为默认入口。
- **命中口径统一（7 vs 19）**：属 contribute.vue 使用层，非编辑器数据模型，另计。
- **存储 v1 数据不迁移**：快速开发阶段，`llmlint.reviewComments.v1`（草稿 key + 草稿坐标）直接废弃，新 key `v2`。

## Implementation Walkthrough

### S1 · 源锚定批注纯核心（✅ 2026-07-06）

- `repair-draft.ts` 新增：`RepairAnnotation`（源锚定 + quote 快照 + resolved）；`annotationAnchorFromDraft`（草稿选区反推**最小**原文锚点，不误吞相邻 edit）、`projectAnnotation` / `projectAnnotations`（投影 + stale 判定）。
- `repair-draft.test.ts`：+7 用例（未改区投影、左/右侧编辑平移、区间内编辑判 stale、草稿选区反推锚点两向、排序）。

### S2 · TextPanel 批注迁移 + 存储 v2（✅ 2026-07-07）

- **纯核心接线时补的三个洞**（S1 计划外，接线推演发现）：
  1. `projectAnnotation`/`projectAnnotations` 泛型化 `<T extends RepairAnnotation>`——评审域字段（`source: "user"|"rule"`）投影透传，纯核心不认识 provenance。
  2. 投影**终点偏置**（`sourceToDraftForAnnotationEnd`）：恰在批注右边界上的零宽插入不计入位移，投影不把紧贴边界的新增文本吞进高亮（起点由 `sourceToDraft` 天然跳过左边界插入）。
  3. **零宽批注语义**：在纯插入文本上建注 → 锚点零宽 `[k,k)`；`isSourceSpanEdited` 零宽×零宽取重合判 stale，零宽×非零宽取严格内部（贴边不算）；投影特例覆盖该插入段的替换文本。
  - `RepairAnnotationView` 类型被泛型返回类型取代，当轮删除。
- **`review-ranges.ts`**：新增 `ReviewAnnotation = RepairAnnotation & {source}`（持久模型）；`ReviewComment` 改注为**投影视图**（from/to = 当前草稿坐标）+ 新增 `stale?`。
- **`review-comment-storage.ts` 重写 v2**：key 按**原文**指纹，存 `ReviewAnnotation[]`；校验只查锚点边界（quote 可能取自草稿，不与原文切片比对）。`useRecentScans` 同步改名（`removeStoredReviewAnnotationsForText` / `clearStoredReviewAnnotations`，删除历史仍按 scan 时原文 key 清 sidecar）。
- **`TextPanel.vue`**：持久态 `comments`（草稿坐标）→ `annotations`（源锚定）；渲染/导出走 `commentViews = projectAnnotations(plan, annotations)`。建注入口 `addComment` 用 `annotationAnchorFromDraft` 反推锚点。**三处 `transformReviewCommentsForTextChange` 调用全删**：watch(text) 搬运整个删除；删除批注的 undo 原样放回（源锚点永远有效）；`resetToOriginal` 不再动批注（投影自动回原文坐标，批注不再因 reset 丢失）。**undo 快照简化**：`restoreSnapshot(plan)` 只回滚 plan——批注不随编辑失效，`restoringSnapshot` 抑制 flag 连根删除。挂载/换源（`originalText` watch、loadSample）按原文恢复批注。
- **stale UI**：批注卡片橙色「原句已改」徽章（title 解释引文可能不一致）；source 背板 / preview 装饰点状橙下划线（`--stale` / `is-stale`）；i18n +2 keys（`review.commentStale[Title]`，zh/en）。

### S3 · 建议 vs 已应用分层（按需显示）（✅ 2026-07-07）

- **源码模式**：`HighlightedTextarea` 的 `replacementRanges` prop（常驻绿下划线 + 浮动 `-> label` 徽章 + 删除候选常驻删除线）整个移除，换 `activeIssueRange`——active 命中只画 accent 定位轮廓。浮标 CSS（`top:-0.78em; left:100%`，绿浮标错位 bug 的直接源头）随之删除。约束记录：**背板必须与 textarea 逐字符对齐，任何行内伪元素都会破坏对齐**，故替换文本永远不进正文层。
- **preview 模式**：`-> replacement` 徽章与删除候选删除线改为**仅 active 命中**显示（`.llmlint-issue-replaceable.is-active::after` / `.llmlint-issue-delete-replacement.is-active`）；非 active 命中只保留级别底色。
- **行为变化声明**：非 active 的可替换命中不再有常驻替换预览。发现性由命中底色、工具条 `替换 N / 删除 M` chips、IssueCard 常驻按钮、active 工具条按钮、选区菜单承担。「未修改」状态下正文不再出现任何删除线/绿标 → 矛盾消除。

### S4 · 删死代码（✅ 2026-07-07）

- `review-ranges.ts` 344→139 行：删 `transformReviewCommentsForTextChange`、`transformReviewDiffsForTextChange`、`buildLineDiffRangesForTextReplacement` 及全部私有 helper（行级 LCS、`locateTextDiff` 等），外加计划外发现的零调用 `applyIssueReplacement`。
- `ReviewEditor.vue`：删 `repairDiffs` prop、`sourceRepairDiffs`、`doReviewDiffsOverlap`；TextPanel 删 `:repair-diffs="[]"`。
- **测试处置**（按重构三问）：`llmlint.test.ts` 删「批注范围随普通文本编辑平移」用例 + `makeReviewComment` helper——它测的正是被消灭的漂移机制；替代覆盖 = repair-draft 批注投影用例（语义更强：不搬运、不漂移、stale 可判）。

### 设计如何约束以后不犯同类错

- 批注持久模型里**没有草稿坐标字段**——想写坐标只能写 `sourceFrom/sourceTo`，「忘了搬运」这类 bug 无处发生。
- `HighlightedTextarea` 不再接受带替换文本的 prop——正文层画不出「未应用的改动」，建议伪装成已应用在接口上不可表达。
- 存储按原文 key：同一篇文章的批注生命周期与修订过程解耦，「改一个字批注全丢/复活」不可再现。

## Verification / Test

- `bunx vitest run tests/repair-draft.test.ts tests/llmlint.test.ts` → **86 passed**（repair-draft 24：21 + 零宽插入批注 / 边界不吞插入 / 泛型透传 3 新用例；llmlint 62：63 − 1 删除的 transform 用例）。
- 根 `bun run typecheck`（tsc）与 `web bun run typecheck`（vue-tsc）全绿。
- **playwright 复验待做**（本会话无浏览器工具）：批注在打字/机械清理/整篇替换后不漂移且 stale 正确亮起；「未修改」时正文无删除线/绿标；active 命中轮廓 + 工具条按钮正常；批注跨修订持久（改字后刷新仍在）。

## TODO / Follow-ups

- [x] **S1**：源锚定批注纯核心 + 测试。
- [x] **S2**：`TextPanel` 批注迁移 + 删命令式搬运 + 持久化 v2 / undo 简化 + stale UI。
- [x] **S3**：建议 vs 已应用编辑分层渲染（按需显示，修绿浮标 / 「未修改」矛盾）。
- [x] **S4**：删死代码（comment/diff transform、`repairDiffs` prop、`applyIssueReplacement`、旧 transform 测试）。
- [ ] **playwright 验收**：按上节清单浏览器复跑改文流程。
- [ ] **S5（独立任务）**：预览精确 offset 映射（替换 `indexOf` 模糊匹配）。
- [ ] 命中口径统一（7 vs 19，contribute.vue 层）。
- [x] 落地后同步根 `PROJECT-STATUS.md`。

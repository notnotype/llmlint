# 改文流程强引导 + 编辑面接入 + 编辑器回归修复

> 接 [Task 09](../09-web-revision-persistence/README.md) 三阶段落地后的 UX 审查与回归修复。
> 权威规范：[CONTEXT.md](../../../CONTEXT.md)（术语 + 不变量，尤其 §2.6 修订/修复、D2/D5）。
> 相关组件：`web/app/pages/contribute.vue`、`web/app/components/TextPanel.vue`、`web/app/components/ReviewEditor.vue`、`web/app/composables/useRepairDraft.ts`、`web/app/utils/repair-draft.ts`。

## Relative documents refs

- [Task 09 web-revision-persistence](../09-web-revision-persistence/README.md) — N 版本地基 + RepairDraft piece-table + 阶段三改文循环（本任务修它的 UX / 回归）
- [Task 07 web-review-editor](../07-web-review-editor/README.md) — 编辑面（TextPanel/ReviewEditor）
- [CONTEXT.md §2.6](../../../CONTEXT.md#26-修订与修复web-编辑--持久侧task-09) — 修订 / 修复草稿术语

## User Request / Topic

Task 09 跑通后，用户实测审查发现一批 UX 问题 + 回归，要求单开任务收拾。

**审查发现（用户按优先级排）**：

1. **[最重要] 改文屏盲改**：report 屏能在正文标出 AI 味在哪、右侧列命中；一进 edit 屏这些全没了——裸 `<textarea>`，无行内高亮、无命中列表。用户对着无标记文本改，不知道改哪，要看只能「返回报告」再回来，循环很差。这是「轻量 textarea vs 完整 RepairDraft 编辑面」取舍的真实代价。
2. **阶段三 UI 全中文硬编码**：切英文时其余变英文、这三屏仍中文，割裂。
3. **[次要] 验收收了「改后 AI 味」却没用在 D5 结论**：界面让人以为 aiFlavor 参与判定，实则判定只用「命中↓ + wantReadOn 不降」。
4. **[小] 暗色可读性**：`text-emerald-600` 的「↓降低」暗色下略暗，缺 `dark:text-emerald-400`。

**用户新增三点**：

1. 本轮要把流程**落实好**：现在前端没有**强引导**去落实文档里的几个流程（上传→盲评→揭示→改文→验收）。
2. 编辑器**每输入一个字符就存一个版本**，应当**失焦（blur）才定版**。
3. 编辑器里**随便输入一个字符就显示「空文本」**。

**用户建议**：#1（改文屏接入完整编辑面）从「收尾」提为下一步优先——用 `TextPanel` 替换裸 textarea，顺带把阶段二 piece-table 编辑器接进主流程（[Task 09](../09-web-revision-persistence/README.md) F-1 的 server adapter 方向）；#2/#3/#4 是打磨。

## Goal

> 把 llmlint web「改文」核心动作从盲改升级为「照着命中改」，并修掉阶段二迁移带出的打字回归：
> ① `contribute.vue` 的 edit 步复用 `TextPanel`（行内高亮 + 命中列表 + 一键接受替换 + piece-table），并加流程强引导（stepper / 状态提示）；
> ② 自由打字改为**合并/失焦定版**，消除「每键一版 + 空文本」；
> ③ 打磨：阶段三 i18n、验收文案点明 aiFlavor 不入判定、暗色配色。
>
> - **Verification**：playwright 复跑改文流程——edit 屏有高亮 + 命中列表、连续打字只成一处（或失焦一处）编辑且不再显示「空文本」、验收与落库仍正确。
> - **Constraints**：不破 Task 09 的 N 版本落库与 D2/D5；不回退 piece-table 单一派生模型。
> - **Boundaries**：只动 `web/`。

## Current State

- **改文屏**（`contribute.vue` step=`edit`）：裸 `<textarea v-model="editDraft">` + 一键机械清理 + 命中数字，**无行内高亮、无命中列表、无接受替换**。report↔edit↔verdict 无 stepper / 强引导。
- **打字回归根因（阶段二迁移引入）**：`TextPanel.updateText` → `useRepairDraft.setDraft` **每次击键**经 `locateMinimalSplice` + `applyDraftSplice` 折成**一条新 edit**（`nextId` 每次新 id，相邻插入不合并）→ 每字符一处离散 diff。插入型 diff 的 deleted 侧为空 → `compactReviewLabel("")` 返回 `review.emptyText`「空文本」（`ReviewEditor.vue:239/249`）。
- **阶段三三屏文案**：中文硬编码（`contribute.vue` edit/verdict 段），未走 `t()`。
- **验收**：`verdictPass = 命中↓ && wantReadOn 不降`；`postAiFlavor` 已收集落库但未入结论，界面无说明。

## Decisions / Discussion

### 优先级（用户拍板 #1 提前）

| 级别 | 项 | 对应 |
|---|---|---|
| **P0** | 改文屏接入完整编辑面 + 流程强引导 | 审查 #1 + 新增点 1 |
| **P1** | 打字合并 / 失焦定版 + 修「空文本」 | 新增点 2 + 点 3 |
| **P2** | 阶段三 i18n / 验收 aiFlavor 文案 / 暗色 | 审查 #2 #3 #4 |

### P0：改文屏接入 TextPanel（= F-1 server adapter 方向）

edit 步用 `<TextPanel>` 替换裸 textarea，contribute 像 `index.vue` 那样喂 `issues/ranges/autoFix/originalText` 等（contribute 已有 `useLlmlint`）。收益：行内高亮 + 命中列表 + 一键接受替换 + piece-table 全部就位，改文从「盲改」变「照着命中改」。commit 时读 TextPanel 的当前草稿 `POST /revisions`。同时加 stepper（上传→盲评→揭示→改文→验收）做强引导。

> 这一步顺带把阶段二的 piece-table 编辑器接进了主采集流程——正是 Task 09 F-1 里「contribute = server-backed adapter」的落地。

### P1：打字合并 / 失焦定版

**根因**：`setDraft` 每键一条 edit。**方案（待定，倾向 A）**：
- **A（推荐）合并当前打字 burst**：`useRepairDraft` 维护「进行中的 user 编辑」，连续打字持续吸收进同一条 edit；`blur` 时封口（下一段打字用新 id）。保持单一 piece-table 模型，只改 edit 粒度。
- **B**：自由打字不产生逐条可 reject 的 diff（回「整篇基线 diff」语义），仅「接受替换 / LLM 改」产生离散 diff。更贴近迁移前观感，但重新引入两类 diff 语义。

**「空文本」**：纯插入 diff 的 deleted 侧本就为空，`compactReviewLabel` 显示「空文本」不友好——改为对纯插入不显示 deleted 侧标签（或显示「（新增）」）。合并 burst 后离散度也大降。

### P2：打磨

- **i18n**：阶段三 edit/verdict 文案抽进 `messages.ts` + `zh-CN`/`en-US`。
- **验收 aiFlavor**：文案点明「AI 味 = 采集数据，不参与本地判定；判定 = 命中↓ 且 wantReadOn 不降（检测器概率腿待接）」。
- **暗色**：`↓降低` 加 `dark:text-emerald-400`。

## Verification / Test

- **playwright 复跑改文流程**：edit 屏出现行内高亮 + 命中列表；点命中能接受替换；连续打字后 diff 不再一字一条、不再显示「空文本」；失焦定版符合预期；验收 + 落库仍正确（`Revision`/`DocJudgment.blind`/`MachineRecord` 同 Task 09）。
- **i18n**：切 en-US，阶段三三屏跟随英文。
- `bun run typecheck` 绿；`bunx vitest run tests/repair-draft.test.ts` 若改动核心则保持绿（合并 burst 若落在 `repair-draft` 层需补测）。

## Implementation Walkthrough

### P0 · 改文屏接入 TextPanel + 流程 stepper（✅ 已落 + playwright 验证，2026-07-05）

- `TextPanel` 加 `embedded` 开关，嵌入时隐藏 playground 专属「示例 / 清空」按钮。
- `contribute.vue` edit 步从裸 textarea 换成**两栏工作台**：左 `<TextPanel embedded>`（行内高亮 + 一键接受替换 + piece-table，复用 `useLlmlint` 算 issues/ranges/autoFix，`original-text=rev0`），右 `FilterControls` + `IssueList`（命中列表，apply → `TextPanel.acceptIssueReplacement`）。
- 顶部加流程 **stepper**（盲评揭示 → 改文 → 验收），`step !== draft` 时显示。
- **验证**：edit 屏有编辑器 + 命中列表 + stepper；「示例」按钮已隐藏；嵌入 TextPanel 的清理机械命中 5→4；commit → verdict「原文 5 → 改后 4」。

### P1 · 打字合并 + 失焦定版（✅ 已落 + playwright 验证）

- `useRepairDraft`：自由打字 burst 复用同一 base plan + edit id 重算 → 连续打字只成**一条**编辑；`sealDraft()` 封口；结构化操作（spliceDraft/editSource/reject/clear/resetSource）与撤销均先封口。
- `TextPanel`：编辑器容器 `@focusout` → `sealDraft()`（失焦定版）。
- **验证**：playground 连打 4 字 → diff 计数 **1/1**（不再每键一版）、「空文本」出现 **0 次**（含激活该 diff 后）。

### P2 · 打磨（部分）

- **✅ R4 暗色**：验收命中对比色补 `dark:text-emerald-400 / dark:text-red-400`。
- **✅ R3 aiFlavor 文案**：验收注明「AI 味作采集数据留存；本地验收只看命中↓ 且想追更不降（检测器概率待接）」。
- **⏳ R2 i18n**：阶段三三屏中文仍硬编码，待抽 `messages.ts` + 语言包。

## TODO / Follow-ups

- [x] **P0**：改文屏接入 TextPanel + 流程 stepper（playwright 验证）。
- [x] **P1**：打字合并 / 失焦定版 + 「空文本」修复（diff 1/1、空文本 0）。
- [x] **P2 · R3/R4**：验收 aiFlavor 文案 + 暗色配色。
- [x] **P2 · R2 i18n**：阶段三 edit/verdict/stepper 中文硬编码抽进 `messages.ts` + `zh-CN`/`en-US`。（已在 [Task 13 W2](../13-web-five-step-flow/README.md) 随五步完形一并完成，含 W2 新增 UI 文案）
- [x] Task 09 收尾项里「edit 步嵌编辑面」**已在 P0 收口**；其余收尾项后续归属：comments 锚原文（[Task 11](../11-editor-data-model/README.md)）、外部检测器腿（[Task 13](../13-web-five-step-flow/README.md) W3）、playground 匿名 adapter（仍开放，见 Task 09 TODO）。
- [x] 落地后同步根 `PROJECT-STATUS.md`（随 Task 13 收口更新）。

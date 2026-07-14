# Web 修订谱系与 N 版本持久化（地基）

> 本文是这次 web 架构复盘的**设计定稿 + 实现计划**，按 [walkthrough 规则](../README.md) 持续更新。
> 权威规范：[CONTEXT.md](../../../CONTEXT.md)（术语 + 不变量，本任务重点 **D1–D5**，并将 **D2/D5 改写为按 revision 计**）。
> 本任务**推翻** [Task 06](../06-web-data-collection/README.md) 的「两版本」schema 决策，理由见 [§推翻 Task 06 的 2-version](#推翻-task-06-的-2-version记-why替代-adr)。
> 前端 RepairDraft 重构归 [Task 07](../07-web-review-editor/README.md)，本任务只依赖其「commit 产出 revision」这一契约。

## Relative documents refs

- [CONTEXT.md](../../../CONTEXT.md) — 领域语言 + 不变量 D1–D5
- [Task 06 web-data-collection](../06-web-data-collection/README.md) — 被本任务推翻的两版本采集 schema
- [Task 07 web-review-editor](../07-web-review-editor/README.md) — RepairDraft 编辑面（消费本任务的 revision）
- `web/prisma/schema.prisma` — 待改的持久层
- `web/app/pages/index.vue`、`web/app/pages/contribute.vue` — 待合并的两条流

## User Request / Topic

架构复盘对话的结论。用户指出 web 有两个核心需求，外加一个被现架构堵死的现实：

1. **改好正文**：静态规则扫描、静态打分、LLM 评估、静态修复、LLM 修复、用户修复。
2. **收集数据**：用户 2 维打分、各种评价与修改、指出「哪里 / 哪一版没改好」。
3. **现实**：用户和 AI 会对同一篇文**改很多次 → 多版本**。现架构（前端两态 + 后端两版本 schema）装不下。

用户要求：顺「多版本 + 两需求」重画地基、给整体设计，并**为持久化单开一个 task**（即本任务）。

## Goal

> 把 llmlint web 的地基从「原文 + 一版 edit」两版本模型，升级为**以不可变「修订 Revision」为脊的 N 版本谱系**：新增 `Revision` 持久表，`DocJudgment / SpanAnnotation / MachineRecord` 改挂 `revisionId`，并把文档生命周期收成一台**守 D2/D5 闸门**的状态机（上传 → 盲评 → 揭示 → 改文循环 → 复评 → 验收）。
>
> - **Outcome**：`Revision` 一等持久 + 三张采集表按 revision 归属；采集流与 playground 编辑流合并为一台状态机。
> - **Verification**：schema 迁移在近 0 数据上干净应用 + 一条 curl API 闭环（建 revision → 按需测量 → 判定 → 验收）复现 Task 06 级别的不变量运行时确认。
> - **Constraints**：不破 D1–D5（D2/D5 改写为按 revision 计，见下）；沿用 Task 06 的 DTO 纪律（客户端不可设服务器字段、机器信号仅服务器写）。
> - **Boundaries**：只动 `web/`（prisma + `server/api` + 采集/编辑流）；前端 RepairDraft 分层派生实现留 Task 07。
> - **Iteration**：先 schema + API 闭环跑通，再合并前端两条流；每次绕道记 walkthrough。
> - **Blocked stop**：若「持久 ≠ 测量」的解耦在 schema 上无法既满足 D5 两点验收又支持 N 版本，停下报告并请求收窄（退回「N 工作版本 + 2 测量检查点」中间路）。

## Current State

- **前端无 revision 概念**：全仓搜 `revision / snapshot / version` 零命中。`index.vue` 是 `text` + `originalText` 两态，`originalText` 仅为算修复 diff（`web/app/pages/index.vue:24`）。
- **后端 schema 钉死两版本**：
  - `AnnotationTarget = original | edit`（`web/prisma/schema.prisma:54`）
  - `JudgmentPhase = pre_edit | post_edit` + `@@unique([userId, textId, phase])`（`:49`、`:115`）
  - `MachineRecord` 为 `Text 1—1`（`textId @unique`）+ 单个 `editContent`（`:137`、`:140`）
- **两条流断裂**：`contribute.vue` = 采集流（有盲评闸门、落库）；`index.vue` = playground（有修复、无闸门、不落库）。两需求要求它们合成一台状态机。
- **真数据近 0**（Task 06「趁 0 数据先落 schema」），**现在迁移最省，晚改代价指数上升**。

## Decisions / Discussion

### 已锁决策（用户拍板）

| 决策 | 内容 |
|---|---|
| **RepairDraft 表示** | **分层派生 + 静态只读**：原文不可变；静态层纯派生（规则选择 → 修复稿）；草稿层锚原文的 append-only 编辑。diff 全部派生，删掉命令式 `diffs` 数组 + `transform*` 位置搬运机制。前端实现归 Task 07。 |
| **数据层版本模型** | **N 版本全持久**：`Revision` 提成一等持久表，measurement / annotation 挂 `revisionId`，泛化掉 `original\|edit` 与 `pre\|post`。 |

### 本轮范围与调研发现（2026-07-05）

**执行范围（用户拍板）**：**B — 全都做**，含 ReviewEditor 分层派生重构。按 F-2 安全次序推进：后端地基先落可验证，再上前端重构；**不把 schema 迁移与 3000 行重写塞进同一补丁**。

**调研发现（下代码验证可行性 / 合理性）**：

- **F-1 公开 playground vs 认证持久流**：`index.vue` 是公开、免登录、不持久的 playground（Task 06 明定的零摩擦价值）；`contribute.vue` 才认证 + 持久。朴素合并会杀掉公开 playground。**解**：`RevisionLineage` 出两个 adapter——ephemeral（匿名）/ server-backed（登录），状态机跨两者，持久按 auth+consent gate（两 adapter = 真 seam，反证模块设计成立）。
- **F-2「跑通」≠ 重写 ReviewEditor**：revision 流用现有编辑机制（autoFix + 手改产出新 body → `POST /revisions`）就能跑；RepairDraft 分层派生是 `ReviewEditor.vue`（2981 行）内部代码质量，单独成阶段，不与迁移捆一个补丁。
- **F-3 blind 服务器算**：`blind = 该 revision 无 MachineRecord`（打分先于揭示）。已落 `judgments.post`。
- **F-4 / F-5**：删 `MachineRecord.editContent`（优化版本身=revision）、删 `SpanAnnotation.target`（original/edit 由 `ordinal==0?` 派生）。已落。
- **F-6 检测器腿悬空**：外部 AIGC 检测器未接、字段原本也没有。**趁 0 数据先落 `detector*` + `docScore` 字段**（Task 06 哲学）；验收先用 `docScore` + `wantReadOn` 跑结构，检测器概率腿标待接。已落 schema。
- **迁移机制确认**：`scripts/init-db.ts` 是确定性 hand-SQL 迁移器（按文件夹名追踪、逐条应用），**绕开 Task 06 记录的 prisma 引擎 Windows 坑**。近 0 数据 → 重写 init 迁移 + reset 最干净。

### 领域脊：修订谱系（Revision Lineage）

把「版本」提成一等领域概念，两个需求都从它长出来：

```
文档 Document (= 一次上传)
  └─ 修订谱系 Revision Lineage        ← 地基脊柱
       rev0 (原文, 不可变)
        │ transition{kind: static_fix, provenance}
       rev1
        │ transition{kind: llm_fix}
       rev2
        │ transition{kind: user_fix}
       rev3 …
```

- **修订 Revision**：文档的一个不可变版本快照。`rev0` = 原文；每轮修复 commit 出一个新 rev。
- **修订边 transition**：`rev_n → rev_{n+1}`，带 `kind`（static_fix / llm_fix / user_fix）与 provenance（哪些规则 / 哪次 LLM 改）。这正是 RepairDraft 的产物。
- **检查点 checkpoint**：被选去做测量 / 落库的 revision（不是每个 rev 都测）。

**关键区分：持久 ≠ 测量。** Revision 便宜（commit 即建），Measurement 贵（人评 + 外部检测器调用），**按需**挂在选中的 revision 上。谱系完整、测量稀疏。这直接化解「每版本测量成本」的顾虑。

### 模块地图（4 深模块 + 纯引擎）

```
useLlmlint (纯引擎)  scan / docScore / applyAutoFix       ← 不动, 无状态
        │ 喂命中 + 静态修复区间
┌───────▼─────────────┐   ┌──────────────────────────────┐
│ ① 修订谱系 Lineage    │◄──┤ ② 修复草稿 RepairDraft (Task07)│
│  Document→Revisions   │   │  基于 rev_n 分层派生, commit    │
│  + transition 血缘     │   │  出 rev_{n+1}                  │
└───────┬───────────────┘   └──────────────────────────────┘
        │ revision 作为锚
┌───────▼──────────────┐   ┌──────────────────────────────┐
│ ③ 评价采集 Judgment    │   │ ④ 流程编排 LifecycleFlow        │
│  measurement/annotation│   │  状态机: 上传→盲评→揭示→改循环   │
│  挂 revisionId, 守 D1-D5│   │  →复评→验收; 守 D2/D5 闸门      │
└───────────────────────┘   └──────────────────────────────┘
```

| 模块 | 职责 | 现有代码归属 | deletion test |
|---|---|---|---|
| ① 修订谱系 | 版本身份 + 血缘 + provenance | **新建** | 删了 → 版本身份散进每个组件和表 ✓ |
| ② 修复草稿 | `rev_n → rev_{n+1}` 分层派生 | Task 07（TextPanel/ReviewEditor 收拢） | 见 Task 07 论证 ✓ |
| ③ 评价采集 | measurement + annotation 挂 rev，守不变量 | `server/api/*`、`contribute.vue` 收拢 | 删了 → D1–D5 散进 API handler ✓ |
| ④ 流程编排 | 生命周期状态机，门控转移 | `contribute.vue` + `index.vue` 合并 | 删了 → 盲评 / pre-post 顺序散成 UI if ✓ |

### 流程状态机（守 D2/D5 闸门）

```
[上传]  原文 → rev0
   ▼   ┌─ D2 盲评闸门: 机器结果全部隐藏 ─┐
[盲评 rev0]  打 2 维分 + 可选 span 标注
   │         DocJudgment{rev0, blind:true}
   ▼   └─ 提交后才准揭示 ─────────────┘
[揭示 rev0 机器首检]  llmlint 命中 + docScore + 外部检测器概率(服务器写) + LLM 评估
   │                  → MachineRecord{rev0}
   ▼
┌──── 改文循环 (需求1, 产出 revisions) ────┐
│  RepairDraft(基于 rev_n): 静态/LLM/用户修复 │
│  → commit rev_{n+1}; 随时 span 标注「这版没改好」│
└───────────────┬──────────────────────────┘
   │  用户选定 rev_k 作为「改后候选」提交
   ▼
[复评 rev_k]  机器复检 + 人评 wantReadOn(非盲)
   │           MachineRecord{rev_k} + DocJudgment{rev_k}
   ▼
[验收]  D5 双条件: detector(rev_k) < detector(rev0) 且 wantReadOn(rev_k) ≥ wantReadOn(rev0)
```

门控点（状态机的价值）：盲评未交 → 机器结果锁死（D2）；两检查点未测齐 → 验收不可算（D5）；机器信号仅服务器写（D5 防伪）。

### 新 schema（相对 Task 06 的 delta）

```prisma
// 新增: 修订谱系的脊
model Revision {
  id             String   @id @default(cuid(2))
  textId         String                          // 归属文档
  ordinal        Int                             // 0=原文, 1,2… 谱系序
  parentId       String?                         // 血缘, rev0 为 null
  body           String                          // v1 存全文(大文本再谈 delta)
  charCount      Int
  transitionKind TransitionKind @default(upload) // upload|static_fix|llm_fix|user_fix
  provenanceJson String?                         // 可选: 本次改动 hunk(规则/LLM 来源), 喂 per-rule 精度
  machineRecord  MachineRecord?                  // 0/1: 未必每版都测
  judgments      DocJudgment[]
  annotations    SpanAnnotation[]
  @@unique([textId, ordinal])
}
enum TransitionKind { upload  static_fix  llm_fix  user_fix }
```

三张已有表跟着变：

- **`Text`**：`body` **下沉到 Revision(ordinal 0)**，`Text` 退化成纯信封（ownership / classification / origin / consent），避免 rev0 有两个真相源。
- **`DocJudgment`**：删 `phase` enum、加 `revisionId`；`@@unique([userId,textId,phase])` → **`@@unique([userId,revisionId])`**（一人一版一条，重打 upsert）；`blind` 保留。
- **`SpanAnnotation`**：删 `target` enum、加 `revisionId`（span 锚该版坐标）。「哪版没改好」= 挂在那一版上的标注，天然成立。
- **`MachineRecord`**：`textId @unique` → **`revisionId @unique`**（每版 0/1，per Text 变 1—N）；删 `editContent`（优化版现在**本身就是一个 revision**）；`detector / llmGuess` 字段留，per revision。

### 不变量重表达

- **D2 盲评**：`blind` 变 per (user, revision) —— 「在看到**该版**机器结果前打的分」；由**服务器**按该 revision 是否已揭示判定，不信客户端。
- **D5 验收**：baseline **固定 = rev0**，candidate = 被提交验收的某个已测 revision。**任意两版互比 = 只读分析视图，不产验收判定**（别让「LLM 版 vs 静态版」冒充验收）。
- **机器信号服务器写**：不变，detector / llmGuess / 命中随 revision 落，客户端不可伪造。

### 推翻 Task 06 的 2-version（记 why，替代 ADR — 本仓无 adr 目录）

Task 06 选两版本的理由是「D5 本质是 pre / post 二元对比」——**正确，但只覆盖了「测量」语义，没覆盖「编辑过程」**：用户 / AI 会多轮改写，且「哪一版没改好」的标注需要**可寻址的中间版本**。

N 版本把「多版本工作过程」与「pre / post 两点测量」**解耦**：工作层任意多 revision，测量层仍是 baseline ↔ candidate 两点。故推翻 2-version 持久，但**保留 D5 的两点验收语义**。

> 未来复盘若想退回 2-version，须先驳倒「多轮改写 + 中间版本标注」这个需求；不要仅凭「D5 是 pre/post」重提两版本。

### 子分叉推荐（可调，未逐个再问用户）

- **F1 Revision 粒度**：显式 checkpoint + 模式边界自动 commit（进 LLM 阶段封静态版；用户点保存封版），**非每次击键**；工作 undo 栈留客户端 RepairDraft、不落库。
- **F2 验收 baseline**：固定 rev0。
- **F3 body 存储**：v1 存全文（60k 上限在，不过度设计）；行体积咬人再上 delta / 父版 diff。

## Verification / Test

- **schema（推荐 init-db 路径，绕开 prisma 引擎 Windows 坑）**：`rm web/data.db && bun run db:init && bun run db:generate` 重建库 + 重生成 prisma client；再 `bun run typecheck`。
- **API 闭环**（照 Task 06 的 curl + cookie jar）：register → 建 Text → 建 rev0 → 盲评 rev0（blind 服务器判 true）→ 揭示（`MachineRecord{rev0}`）→ 建 rev_k（带 `transitionKind`）→ 测 rev_k → 复评 → `export` 按 `engineVersion` 分组。
- **不变量运行时确认**：盲评先落、机器信号仅服务器写、DTO 拒服务器字段、`@@unique([userId,revisionId])` upsert。
- **负路径**：空 `revisionId` / 客户端伪造 `detector` → zod 400 / 拒。

### 阶段二编辑面 · app 行为验证清单（需浏览器跑）

`cd web && bun run dev` 后在 playground（`/`）逐项确认（piece-table 迁移未改行为，只换底层机制）：

1. **自由打字**：连续输入 / 删除 / 中间插入，光标不跳、文本不被回写篡改。
2. **接受命中替换**：右侧列表点应用 → 正文替换、diff 出现、可撤销。
3. **撤销**：每个操作的「撤销」通知都能精确回退（含快照）。
4. **diff 导航 / 清除**：`Ctrl+Alt+N/P` 跳差异、`Ctrl+Alt+Enter` 清当前差异（该处回原文）。
5. **Markdown 格式化**（preview）：粗 / 斜 / 列表 / 标题 / 链接后文本与光标正确。
6. **剪贴板整篇替换 / 机械清理**：产生差异、可撤销。
7. **批注**：选区加批注、编辑、删除、导航；改文后批注位置仍跟随。
8. **重置为原文**：草稿回原文、批注搬回。

## Implementation Walkthrough

### 阶段一：后端地基 + 领域语言（已落，2026-07-05）

- **CONTEXT.md**：加 §2.6 修订术语（`revision` / `revision lineage` / `transition kind` / `checkpoint` / `repair draft` / `hunk provenance`），并注明 `repair draft` ≠ 语料 `repair`；D2 / D5 追加「按 revision」改写（`blind` per (用户×revision)、验收固定 rev0↔rev_k 两检查点）。
- **schema.prisma**：新增 `Revision` + `TransitionKind`；`Text` 去 `body/charCount` 变纯信封；`DocJudgment/SpanAnnotation/MachineRecord` 改挂 `revisionId`、删 `phase/target` enum；`MachineRecord.revisionId @unique`、删 `editContent`、加 `docScore` + `detector*`；`parentId` 软指针（无 FK）；`@@unique([userId,revisionId])`、`@@unique([textId,ordinal])`。
- **migration.sql**：重写 init 迁移到最终形态（pre-release + 近 0 数据，配合 reset）。
- **server/api**：新增 `revisions.post`（ordinal 服务端算、单调自增）；`texts.post` 建 Text + rev0（`transitionKind=upload`）；`judgments/scans/annotations` 改收 `revisionId`，抽 `utils/ownership.ts`（revision→text→owner，3 处复用）；`blind` 服务端判定；`scans` 收可选 `docScore`；`export` 改 dump 谱系 + `byEngineVersion` 索引（phase/target 由 ordinal 派生保旧语义）。
- **contribute.vue**：最小修正（捕获 `revisionId`，三处调用换字段）保持采集流不断；edit 环 + verdict 留阶段三。

**验证（需你在沙盒外跑 bun）**：见 [§Verification](#verification--test)。**已落 schema/API 但未经 typecheck**（prisma client 需先 `db:generate` 重生成）。

### 阶段二：前端 RepairDraft 分层派生（进行中，2026-07-05）

- **✅ piece-table 纯核心**（`web/app/utils/repair-draft.ts`）：源锚定 edit 表 + `foldDraft`/`deriveDiffs` 派生 + `applyDraftSplice`/`applySourceEdit` 合并语义（改到已改过区域正确吸收原编辑）+ `sourceToDraft`/`draftToSource` 边界精确映射 + `locateMinimalSplice`（整串回传→单次 splice）。**杀掉命令式 diffs + transform\* 的算法基础已就位。**
- **✅ 测试**（`tests/repair-draft.test.ts`，vitest，**14/14 绿**）：核心不变量「splice 后草稿 === 旧草稿上直接做同样字符串替换」+ 合并 / 改回原文即消 / 纯插入 / 整篇替换 / 边界映射 / setDraft / **尾部插入吸收（浏览器揪出的 bug 回归）**。
- **✅ Vue 组合式**（`web/app/composables/useRepairDraft.ts`）：唯一 mutable = `plan`；`draft`/`diffs`/`changed`/`netDelta` 派生；命令 `setDraft`/`spliceDraft`/`editSource`/`reject`/`clear`/`resetSource`。**additive、未接线，不影响现构建。**
- **✅ TextPanel 迁移**（`bun run typecheck` 绿，待 app 行为验证）：换用 `useRepairDraft`；删命令式 `diffs`/`pendingDiffs`/`diffSequence`/`repairBaselineDiffs`——diff 全从 plan 派生；编辑函数（accept / replace-selection / clipboard / cleanMechanical）改走 plan 命令 + **plan 快照撤销**；`watch(text)` 只剩批注搬运（diff transform 删除）；`text` 作为 draft 镜像（mirror watch 唯一写回点）。
- **✅ ReviewEditor 消费收敛**：`:repair-diffs="[]"`——派生 diffs 既是 baseline 又可操作，双 diff 调和（`sourceRepairDiffs`）自然退化；`clear-diff` → `repair.reject(id)`（diff id ≡ edit id）。ReviewEditor 本身无需改动。
- **✅ app 行为验证（playwright）**：打字不篡改（净字数精确）、机械清理正确。**揪出并修了 `applyDraftSplice` 按源空间判吸收漏掉「尾部零宽插入」的 bug**——整篇替换（cleanMechanical）会重复追加文本；改为按 **draft 空间严格重叠** 判吸收，加回归测试。reset/undo 走同一 plan 快照路径。
- **↩ 刻意留作后续**：comments 仍 draft-anchored + comment transform（未锚原文）；`cleanMechanical` 降为单条 bulk static 编辑（丢逐规则粒度）；ReviewEditor 现已 vestigial 的 `repairDiffs` prop 清理。

### 阶段三：改文循环 + 验收（✅ 已落 + playwright 端到端验证，2026-07-05）

`contribute.vue` 从两步（`draft → report`）扩成四步状态机 **`draft → report → edit → verdict`**：

- **report**：加「开始改文优化」入口。
- **edit**：可编辑草稿 + 一键机械清理 + 实时命中数（改后 vs 原）；「提交改后版本」= `POST /revisions{parentId=rev0, transitionKind=user_fix}` + `POST /scans{revisionId=rev_k}`。
- **verdict**：命中对比（rev0 vs rev_k）+ 改后非盲复评（`POST /judgments{revisionId=rev_k}`，phase 由服务器按 ordinal 派生）+ **D5 双条件**判定（命中降 且 `wantReadOn` 不降；检测器概率腿标待接）。

**端到端验证（playwright + 直接查库）**：注册 → 上传盲评 → 揭示 → 开始改文 → 清理机械（命中 5→4）→ 提交改后版本 → 提交复评 → 「✓ 通过 D5 双条件」，无 console error。落库确认：`Text×1`、`Revision×2`（rev0 upload 无 parent / rev1 user_fix 有 parent）、`DocJudgment×2`（**rev0 `blind=1` / rev1 `blind=0`，服务器按 revision 正确判 D2**）、`MachineRecord×2`（1—N 生效）。

**刻意留后续**：edit 步用轻量 textarea + autoFix（未嵌入完整 RepairDraft 编辑面）；`index.vue` playground 双 adapter（F-1 匿名 ephemeral）未做；阶段三 UI 文案 i18n 待补（v1 中文硬编码）；外部 AIGC 检测器腿。

## TODO / Follow-ups

- [x] **CONTEXT.md**：术语 + D2/D5 按 revision 改写（阶段一）。
- [x] **后端 N 版本**：schema / 迁移 / API / DTO / ownership helper（阶段一，typecheck 绿）。
- [x] **阶段二 RepairDraft**：piece-table 核心 + 14 测试 + `useRepairDraft` + TextPanel 迁移（typecheck 绿 + playwright 验证，修了尾部插入吸收 bug）。
- [x] **阶段三 改文循环 + 验收**：contribute 四步状态机 + playwright 端到端 + 落库确认。
- [x] **RepairDraft 收尾**：edit 步嵌入完整编辑面（[Task 10](../10-repair-flow-ux/README.md) P0 收口）；`cleanMechanical` 逐规则粒度（[Task 13](../13-web-five-step-flow/README.md) W3+W4 改为逐 AutoFixChange splice 携 ruleId）。（comments 锚原文、vestigial `repairDiffs` prop 清理已在 [Task 11](../11-editor-data-model/README.md) 完成。）
- [ ] **playground 双 adapter**（F-1）：`index.vue` 匿名 ephemeral revision。
- [x] **阶段三 UI i18n**：已在 [Task 13](../13-web-five-step-flow/README.md) W2 随五步完形完成（zh-CN/en-US）。
- [x] LLM classification（[Task 13](../13-web-five-step-flow/README.md) W6 异步补空）与外部 AIGC 检测器接入（同 W3 服务端腿 + MachineDetect）已落地。
- [x] 同步根 `PROJECT-STATUS.md`（随 Task 13 收口更新）。

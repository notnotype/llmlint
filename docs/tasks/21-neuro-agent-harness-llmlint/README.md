# NeuroAgentHarness 接入 llmlint

## User Request / Topic

将 `NeuroAgentHarness` 独立为公开库，并让 llmlint 作为第二消费者完成生产 hard cut，验证独立 Core 能否承载 AI 改写、Profile、SSE、持久化、恢复和业务投影语义。

## Goal

在不改变 llmlint 现有 API、前端状态机和 `AgentHarnessPort` 的前提下，只保留公开 `@notnotype/neuro-agent-harness` 实现。历史 Session 通过显式、可恢复命令重建；两仓测试和真实 Pi smoke 证明 Profile、Prisma SessionStore、Pi ModelRuntime、业务 projector、abort/retry、部分结果和 SSE replay 的公共行为。

## Current State

- 独立库已公开发布为 `@notnotype/neuro-agent-harness@0.1.0`，llmlint 使用精确 npm 版本和 registry integrity，不依赖 sibling 源码。
- llmlint composition root 位于 `web/server/agent/index.ts`。
- `LocalAgentHarness`、灰度开关、phase 混合路由、第二层 `AgentEventBus` 和 `harnessKind` 已删除；analysis/optimize 永远由独立 Core 执行。
- Prisma `AgentSession` 持久化 `initialJson`、`hostContextJson`、`version`；`AgentInvocation` 持久化 caller/retry/error/pending approval/termination reason 等恢复字段。
- 7 个历史 `llmlint.review` Session 已从备份可恢复地重建；hard-cut migration 已应用，ledger 已清理。
- `MachineLlmReview` 仍是 llmlint 业务投影，Core 和 SessionStore 不引用该表。

## Decisions / Discussion

### Adapter 位置

llmlint 继续依赖自己的 `AgentHarnessPort`。新库不暴露 Pi 或 Prisma 类型；宿主提供：

- `PrismaSessionStore`：将 Core `SessionSnapshot` / `SessionWritePlan` 映射到现有 Prisma 表，并在 transaction 中执行 optimistic version 校验。
- `LlmlintPiModelRuntime`：将 Core provider-neutral message/tool/event 映射到当前 `@earendil-works/pi-ai` 版本。
- `createLlmlintProfile`：保留 `replace` / `finish` 与 analysis 的 context/chunk/hit/report 工具语义，编辑/报告事实通过 Core `SessionWritePlan` 落盘。
- `NeuroAgentHarnessAdapter`：将 Core snapshot/event 映射回 llmlint DTO；SSE route 直接消费 Core replay/live subscription。

### 业务投影边界

`MachineLlmReview`、rule hits、score、revealedAt 和权限不进入独立库 Core。analysis Profile 只产生结构化 output，由 llmlint 的 `SessionCommitObserver` 投影到 `MachineLlmReview`；权限仍由 Adapter/route 负责。

### 硬切策略

灰度 spike 完成后不保留双运行时兼容层。composition root 只创建独立 Core Adapter；旧 Session 通过显式重建迁移，不按字段或 invocation phase 回退。

## Spike Verification / Test

独立库：

```text
bun run verify
34 tests passed, 158 assertions
```

llmlint：

```text
bun test
202 tests passed, 697 assertions
bun run typecheck:server   # web
```

Adapter 专项测试：

- `tests/neuro-agent-harness-profile.test.ts`
- `tests/neuro-agent-harness-pi-runtime.test.ts`
- `tests/neuro-agent-harness-prisma-store.test.ts`
- `tests/neuro-agent-harness-adapter.test.ts`

覆盖 optimize replace/finish、analysis context/chunk/hit/report、MachineLlmReview observer、stale selection、abort partial output、Prisma 原子 commit/version conflict、Core message/tool/event 转换、空 neuro session 快照/SSE 路由、analysis `agent_start` phase 和 SSE replay。

## Spike Implementation Walkthrough

1. 将独立包加入 llmlint 本地依赖，并生成 Prisma migration。
2. 先实现 Prisma Store，再实现 Pi Runtime，确保 Core 不引用 llmlint/Pi 类型。
3. 把 optimize 工具迁移为 Profile；编辑记录用 `llmlint.edit` host entry 投影给前端。
4. 用 composition root 选择 `LocalAgentHarness` 或新 Adapter；新建 session 走 Core，历史 local session 按 phase 选择 analysis 回退或 optimize Core。
5. Core 的 `settleFailure` 支持在 abort/failed terminal commit 前保存结构化 output，使改写可以保留部分成果。
6. 收尾审计发现首次 invocation 前的 neuro session 会因缺少 latest invocation 误回退；已改为优先按 `harnessKind=neuro` 选择 Core，并补公开 `AgentHarnessPort` 回归测试。

## TODO / Follow-ups

- 浏览器端仍只提供人工验收清单，本轮按约定没有自动浏览器验证。
- 当前部署合同明确为单 Node + SQLite；若未来需要多进程部署，必须新开架构任务设计 lease、跨进程事件与事务边界，不能直接复用进程内 queue。
- NeuroBook 接入作为后续独立任务，在本次公开包与 llmlint hard cut 全部门禁通过后再开始。

## 2026-07-14 生产 hard cut

灰度验证完成后按用户拍板删除双运行时。`LocalAgentHarness`、`LLMLINT_NEURO_AGENT_HARNESS`、phase 混合路由、`harnessKind` 运行时判断和第二层 `AgentEventBus` 已删除；composition root 永远创建独立 Core Adapter。

### Core 和结果语义

- Core completed Invocation 持久化 `tool_terminate` / `natural_stop` / `max_turns`，`settleRun` 可按原因决定业务输出。
- optimize 的 finish 为完整结果；natural-stop/max-turn 有 edits 为 completed partial；abort/provider failure 有 edits 保留 partial 且不伪装状态；零 edits 不产生成功改写。
- Invocation 冲突和不可重试状态有公开错误类型，llmlint 稳定映射 HTTP 409；completed invocation 在宿主层禁止 retry。

### Adapter 和持久化

- `subscribeEvents()` 改成 `connected + AsyncIterable + close()`；SSE 直接消费 Core replay/live stream，订阅局部 partial message 状态会随 close 释放。
- `agent.message` 只保存模型 transcript；`llmlint.request` 保存用户原始要求。刷新快照可恢复 thinking、Tool Call、Tool Result，不再把完整正文 prompt 显示成用户气泡。
- Prisma create 使用 revision/profile 原子 upsert；全进程按 create key / session key 串行 SQLite 写入。两个 Prisma client 同 Session 并发提交稳定表现为一次成功、一次 version conflict，不再暴露 `SQLITE_BUSY`。
- recovery 只中断实际 running Invocation，waiting 保持 waiting。部署约束见 [ADR 001](../../adr/001-single-node-sqlite-agent-runtime.md)。
- `MachineLlmReviewProjector` 同时实现 commit observer、`reconcileSession()` 和 `reconcileAll()`；snapshot 前会自愈 observer 遗漏，Core/Store 不认识业务表。

### 历史数据重建

新增 `bun run agent:migrate-neuro`：预检公开包精确版本、模型配置和数据库；用 `VACUUM INTO` 生成一致性备份；`_agent_session_rebuild` ledger 按 `pending → deleted → session_created → analysis_started → completed` 推进。命令显式删除旧 Session/Entry/Invocation/Review，创建新 Session，真实重跑 analysis；失败保留最后成功阶段并可重复执行。全部完成后导出 JSON 报告、应用 hard-cut migration、再清理 ledger。

与原计划顺序的唯一调整：ledger 在 hard-cut migration 成功后才删除，避免 migration 失败时丢失恢复依据。

### Final Verification

- 独立库：`bun run verify`，38 tests / 169 assertions。
- 独立 tarball：Bun root/Memory/JSONL/testing 导入 + Node 22 ESM TypeScript 编译运行通过。
- llmlint 专项：Profile、Adapter、Prisma Store、Projector、timeline、重建状态机全部通过。
- llmlint 全量：211 tests / 729 assertions。
- 干净 SQLite：6 条 Prisma migrations 全部成功；诊断确认 Windows Prisma schema engine 要求 migrate 子进程使用相对 `file:` URL，CLI 已规范化。
- llmlint 根 typecheck、web client/server typecheck 和 Nuxt production build 全部通过；build 只有既有 chunk size、sourcemap 和第三方 ESM warning。
- npm registry 复核：`0.1.0` integrity 为 `sha512-OGQ5Gj6BZ3ke4GqxbqSX1pXJTjnl1Q9GlJVmXMbNLv6P8+M9VQyCwJuLHOsOwdsUVuDnPi9cq5bmx3PHB7alRA==`。

### 真实迁移与 Pi smoke

- 公开包已发布并由 llmlint 精确安装；`package.json` / `bun.lock` 均无 `file:` sibling 依赖。
- 真实数据库重建于 2026-07-14 完成：7/7 revision 成功，0 failed。备份为 `.agent/backups/llmlint-agent-2026-07-14T15-08-14-909Z.db`，报告为 `.agent/agent-session-rebuild-2026-07-14T15-21-40-700Z.json`。
- 迁移中有 2 个 revision 共出现 3 次 provider `length` terminal；重建器按正式 retry 链恢复，最终 7 个最新 analysis Invocation 全部 `completed + tool_terminate`，7 个 Session 全部存在 `MachineLlmReview`。
- `harnessKind` 列和 `_agent_session_rebuild` 表均已删除，`terminationReason` 已进入最终 schema；重复运行迁移命令会幂等返回“hard cut 已完成”。
- 备份前后 `Text=21`、`Revision=25`、`MachineScan=25`、`MachineDetect=24`、`DocJudgment=10`、`SpanAnnotation=1`，保留业务数据计数完全一致。
- 真实 Pi smoke：analysis 7/7；optimize finish 3 turns / 2 edits / `tool_terminate`；SSE 在 seq 35 断开后用同 epoch/cursor 重连并收到 completed terminal；max-turn 使用一次性 smoke harness 将生产 Profile 的 `maxTurns` 收紧为 1，真实 replace 后得到 `max_turns + partial`；abort 2 turns / 1 edit，终态 `aborted` 且保留 partial output。

### 与计划的出入

- ledger 删除顺序调整为 hard-cut migration 成功后再删除，避免 migration 失败时丢失恢复依据。
- 为避免真实 provider 空耗 64 轮，max-turn smoke 只在一次性 Memory harness 中覆盖 `maxTurns=1`；Profile、Pi Runtime、replace 工具和 `settleRun` 均使用生产实现，生产配置未修改。
- 第一次 smoke 从仓库根运行，Prisma 相对 URL 指向错误位置并立即失败，没有调用模型；随后从 `web/` 正确工作目录重跑，误生成的根目录 0 字节 `data.db` 已删除。
- 按用户约束没有自动执行浏览器验证。

## 2026-07-18 SQLite 恢复与 SSE 断连加固

运行实例暴露了两条此前测试没有覆盖的消费者级生命周期问题：启动恢复期间 `MachineLlmReview.upsert()` 会与 SQLite writer 竞争并抛出 `P1008 Operation has timed out`；浏览器断开后 heartbeat / forward task 仍可能向 H3 已关闭的 `WritableStream` 写入，形成 `unhandledRejection`。

### 根因与实现

- 本地 libSQL 连接统一设置 15 秒 busy timeout，用于 dev 重启短暂重叠、备份或外部连接持锁；没有引入无限重试。
- `MachineLlmReviewProjector.reconcileSession()` / `reconcileAll()` 只查询没有关联 review 的 completed analysis。已有投影不再在每次启动和 snapshot 前重复 parse/upsert。
- projector 的 session/all reconcile 与 Adapter 的完整 startup reconcile 均做进程内防重入；并发调用共享同一任务，失败后可再次执行。
- Nitro startup 不再并行启动 Harness 和 detector 两组 SQLite 恢复写；两组顺序执行、分别捕获并记录错误。恢复失败不会成为未处理 Promise，后续 snapshot 的 `reconcileSession()` 仍可自愈业务投影。
- SSE route 新增 `AgentSseLifecycle` 深 Module，统一拥有 connected、heartbeat、Core subscription、forward task 和 H3 writer。客户端 close、subscription end、在途 `push()` 拒绝都进入同一个幂等 cleanup；route 不再启动无人收敛的永久后台 Promise。

外部锁回归使用独立 Bun 进程持有 SQLite write transaction，避免在同一 JS event loop 中用 Prisma deferred transaction 制造不可释放的测试死锁。该 fixture 与报错的单语句 projector `upsert` 链一致。

### Verification

- `bun test tests/agent-sse-lifecycle.test.ts tests/neuro-agent-harness-review-projector.test.ts tests/neuro-agent-harness-prisma-store.test.ts tests/neuro-agent-harness-adapter.test.ts tests/agent-chat-flow.test.ts tests/agent-chat-projection.test.ts --reporter=dot`
  - 6 files / 19 tests passed。
- `bun run typecheck` passed。
- `bun run web:typecheck` passed；仍打印既有 `vue-router/volar/sfc-route-blocks` plugin load warning，但退出码为 0。
- 未执行浏览器验证，也没有对 3001 端口实例做自动交互。

### 与原计划的出入

- 原计划只要求 per-session commit queue；实际报错位于业务 projector 且可由外部 SQLite writer 触发，因此加固放在连接 busy timeout、缺失投影查询和 startup 生命周期三个真实边界，没有把业务表或重试策略下沉到 Core。
- 没有建立全站数据库写队列。llmlint 仍只支持单 Node；busy timeout 只容忍短暂外部锁，不把两个长期运行的 Web 进程变成受支持部署形态。

## 2026-07-19 Revision Text Workspace 与 Agent 工具面

原 Profile 的 `replace/finish` 和 analysis `context/chunk` 工具面已收敛为 invocation-scoped `RevisionTextWorkspace` 深 Module：

- `read` 默认读取 current 工作副本，也可按 ordinal/revisionId 读取同一 Text 的历史 Revision；历史版本永远只读。
- `edit` 使用 NeuroBook 同构的批量唯一、非重叠精确替换；选区 invocation 硬限制写入范围。
- `lint_check` 直接 import scanner/reporter，返回 CLI 同构带行号报告及有界结构化 issues，不 spawn CLI。
- `lint_fix` 只执行 `fixability:auto`，修改 current 工作副本并记录 static/ruleId durable edits。
- `get_detection_heatmap` 逐检测器返回 doc/max 概率和 span→行号 chunks；工作副本已修改时明确标记基底结果可能过期，不聚合不同检测器。
- 每次写工具除 `llmlint.edit` 外还保存最新 `llmlint.workspace`，使重复字符删除等无法仅靠 old/new 唯一重放的 partial result 仍能无歧义恢复。

Revision 数据库快照继续不可变；工具不创建 Revision，最终正文仍进入现有 diff 审阅与用户提交链。工具文本、issues 和 heatmap chunks 均有大小上限。

Cancel HTTP 现在绑定 active invocation ID；Adapter 对 stale ID 返回 409，Core abort 后由 SSE terminal/snapshot recovery 收口，前端不再用一次即时 refresh 猜测取消完成。aborted partial edits 保持原有业务语义。

验证：新增 `RevisionTextWorkspace` 7 类主行为回归并扩展 Profile/Adapter；全量 21 files / 181 tests、根 typecheck、web typecheck 和完整 Nuxt production build（client/SSR/Nitro）全部通过。build 仅有既有 sourcemap、chunk-size、第三方 ESM/deprecation warning。

计划与实际差异：为保证 lint_fix 的 abort/provider-failure partial result，实施额外增加 durable workspace snapshot；这是恢复真相所必需，不是兼容层。没有把 Revision、scanner 或检测器业务下沉到 Harness Core。

## 2026-07-19 审查补漏与工作流守门（历史，固定顺序已被 2026-07-20 结果约束替代）

- `read` 对单个超长行也执行 64 KiB UTF-8 预算，并返回同一行的 `nextCharacterOffset`，可无损续读。
- `lint_check` 超过 50 条时明确报告总命中、展示数和省略数，不再让截断后的 reporter 汇总看起来像全文总数。
- 热力图的 500 chunk 限制改为所有检测器共享的总预算，并同时返回全局及逐检测器省略数。
- `AgentInvokeRequest.workflow="full_repair"` 成为一键修到底的显式协议；Profile 以 invocation-scoped 状态约束 read、lint、heatmap、safe fix、复扫、可选 edit、最终复扫和 finish，普通 optimize 不受影响。
- `finish` 在零 edits 时返回工具错误，不能制造 completed optimize output。

验证：22 files / 187 tests passed；根 typecheck、web typecheck、完整 Nuxt production build 通过。web typecheck 仍输出既有 Volar route-block plugin warning；build 只有既有 sourcemap、chunk-size、第三方 ESM/exports warning。

## 2026-07-19 上下文、输出预算与检测记录工具（历史，full-repair 顺序已被 2026-07-20 替代）

- 整篇 optimize 不再把完整草稿重复写入模型用户消息；`request.body` 只作为 invocation 工作副本、恢复和 stale 校验真相，模型通过 `read` 获取正文。
- repair prompt 升级到 `repair-agent-v2`；analysis prompt 升级到 `llm-rules-agent-v5`，清除旧 `get_lint_context/read_document_chunk` 工具术语。
- Pi Runtime 不再使用固定 4000 token；实际单轮预算取模型声明 `maxTokens` 与 65,536 cap 的较小值。真实数据库中近期“自动停止”已确认是 provider `stopReason=length`，不是 Harness natural-stop。
- `get_revision_detections` 替换 `get_detection_heatmap`，按 Revision 返回已落库 regex scan、LLM review、AIGC 检测器原始 chunks 和三路状态；未揭示、跨 Text 或不存在的 Revision 拒绝访问。
- `lint_check` 继续扫描 invocation 当前工作副本；持久化检测记录与实时扫描不混为一谈。
- full-repair 顺序改为 read → persisted detections → lint → safe fix → lint → optional edit → final lint → finish。

后续 TODO：评估用 nb-history 承载 Session 历史浏览/分支；另行设计带 approval、幂等和长任务恢复的 Revision 提交、Session 切换及检测触发 workflow。本轮不加入写工具。

验证：22 files / 195 tests passed；根 typecheck、web typecheck 和完整 Nuxt production build 通过。未执行自动浏览器验证。

## 2026-07-19 长轮次中止与 workspace 实时恢复

- 近期 optimize 失败的根因不是 Harness natural-stop，而是 llmlint Pi client 把每个模型轮次硬截为 120 秒；provider 随后返回 `Request was aborted`，内部重试使同一轮 thinking 从头重复。现已删除本地墙钟，只保留 Harness 用户取消和 provider/网络自身错误。
- provider timeout/aborted 现在直接 failed，不自动重试；429、5xx 和连接瞬断仍保留有限重试。每次 retry 的 `message_start` 会原位清空前一 attempt 的 live partial，durable transcript 仍只保存成功结果。
- `llmlint.workspace` 从普通 timeline entry 提升为专用 SSE control event；active optimize snapshot 同时暴露最新 workspace，断线、seq gap 或刷新可恢复最新工作副本。
- llmlint Adapter/Profile 仍是 workspace 投影边界，NeuroAgentHarness npm Core 未修改。

验证覆盖 provider 分类、active workspace snapshot、SSE replay 和 retry partial 替换。仓库全量 22 files / 197 tests、根 typecheck、web typecheck 通过；未自动执行浏览器验证。

## 2026-07-20 同 Session 多 Revision 与规则结果约束

- `AgentSession` 现在承载同一 Text 的线性 Revision lineage，`AgentSession.revisionId` 只是当前指针；每个 `AgentInvocation.revisionId` 是 analysis/optimize 所属版本的唯一事实。
- `advanceRevision()` 在 Adapter 的 session command queue 内幂等执行。目标 analysis 已存在时直接返回；Session 已推进但 Invocation 缺失时补建；首次推进只允许同 Text、已揭示的直接子 Revision，active Invocation 冲突返回 409。
- Session Host Context 的推进与回滚统一经过 `core.write()`，不绕过 Core 直接写 Store。重复 reveal 最终复用同一 Session/Invocation，父版本稳定 Session 优先从其最新 analysis Invocation 定位。
- 历史 Analysis 重试使用当前 head Session，但 Invocation 保留目标历史 `revisionId`，不会倒退 Session 当前指针；取消只匹配 active Invocation 的 `phase=analysis + revisionId`。
- Analysis 的全文读取合同从“读过行号”收紧为逐行 UTF-16 覆盖区间。超长单行、空行、行中分片和乱序分页都必须完整覆盖后才能 `report_result`。
- 一键修到底删除 `workflow=full_repair` 与固定工具顺序，改用纯结果目标 `objective=eliminate_rule_hits`。`read/lint_check/get_revision_detections` 可并行读取，`lint_fix/edit/finish` 保持顺序写；`edit` 可作为第一项工具，编辑次数无 64 次业务上限。
- `finish` 自行重扫当前工作副本：仍有实时 regex 命中或已落库 LLM quote 仍存在时拒绝结束。普通 optimize 不启用全文清零门禁。
- Prompt 当前版本为 `repair-agent-v4` / `llm-rules-agent-v6`：规则事实优先，禁止用模型主观语感否定命中；AIGC 热力图只用于优先级，不替代规则事实。
- 前端“一键修到底”显式使用全文 scope，不携带残留选区；普通消息仍保留选区。外部 detector 保留 120 秒有限轮询，LLM terminal 由同 Session SSE/snapshot 按 Invocation revision 收口。

本节是当前合同；上面的 `workflow=full_repair`、repair v2/v3、llm-rules v5 与固定顺序段落仅保留为历史 walkthrough，不再描述运行时现状。

## 2026-07-20 风险分层润色与历史恢复终止边界

- `objective=eliminate_rule_hits` 已被 `objective=polish_ai_risk` 直接替代，不保留兼容值。
- Optimize Prompt 升为 `repair-agent-v5`：先理解文本，再对高风险句段做句子/段落级小范围润色；内部生成至少三个合格候选，排除语义/语法/人物声音不合格项后，选择最不像模型惯用表达的方案。
- registry 的 `ruleVerdicts` 进入 `RevisionTextWorkspace`：strong 必修；当前启用的 `vocabulary.*` 作为 AI 敏感词必修，具体改法由模型结合语境决定；weak、LLM Review、noise/insufficient 信号只作上下文判断。
- `lint_check` 内容和 details 都公开 `repairPolicy`；`finish` 使用不受 50 条展示预算影响的全量必修集合，不再要求 regex/LLM quote 全部清零。
- 一键入口先通过现有编辑器静态修复能力应用 `fixability:auto`，再把更新后的草稿交给 `polish_ai_risk` Invocation；该目标的 Profile 工具面移除 `lint_fix`，普通 optimize 仍保留它。auto 修改继续以 static/ruleId 进入修复计划和最终 Revision provenance。
- 历史恢复不再自动 POST reveal。若 lineage Session 仍有 active Invocation，`useAgentChat.abortRestored()` 重新读取 snapshot 并按 invocationId abort；未揭示 head 保持只读，由版本条“继续检测”显式恢复。
- 审查补漏：跨篇 `abandonAll()` 同时清除上一 Session 的 local invocation/aborting/run phase，避免旧取消状态吞掉新 Session 的 abort；eval report 缺失、`registry.ruleVerdicts` 合法省略时，非词汇规则降级为 contextual，`vocabulary.*` 必修合同继续生效。

本节替代上方 `repair-agent-v4`、`eliminate_rule_hits` 和“规则全部消除”的当前态描述；旧段落仅保留为历史记录。

### Final Verification

- 核心专项：Adapter/Profile/Workspace、状态投影、SSE、Store、Projector、Analysis capability、Pi Runtime/llm-fix 与 useAgentChat 全部通过；新增覆盖跨篇 abort 状态清场、objective Adapter 往返和无 verdict 降级。
- migration/rebuild：3 tests 通过，覆盖 Invocation revisionId 回填、Review 保留、幂等重建与中断续跑。
- 仓库全量：34 files / 290 tests 通过，包含 generator/model-client；新增一键预应用正文时序和 `polish_ai_risk` 工具面回归。
- `bun run typecheck`、`bun run web:typecheck` 通过；Web typecheck 仍打印既有 `vue-router/volar/sfc-route-blocks` 插件警告，但退出码为 0。
- `web` Nuxt production build 在本轮修改后重新执行，用时 796 秒，完成 client、SSR 与 Nitro node-server 产物；只有既有 sourcemap、chunk-size、第三方 ESM/exports/deprecation warning。

### 与计划的出入

- 根 typecheck 首次发现 composable 测试位于根 `tests/` 会把 Nuxt 文件错误纳入非 Nuxt tsconfig。测试移动到 `web/tests/nuxt/`，仍由统一全量 test 命令执行，并改由 Nuxt tsconfig 检查真实 Vue/auto-import 类型；没有给根项目伪造 `$fetch` 或 `.vue` 声明。
- 全量门禁复核发现 `bun:sqlite` migration 测试不能由 Node/Vitest 加载。根 `test` 脚本现显式串联 23 个 Vitest 文件与 11 个 Bun-only migration/web/evals 文件，一条 `bun run test` 即覆盖全部 34 个文件，不再依赖人工补跑。
- 没有新增 route 级 reveal 测试壳；并发/中断/回滚行为通过公开 `AgentHarnessPort.advanceRevision()` 端到端覆盖，reveal handler 只负责 owner/reveal 与 `waitUntil` 异常收口。
- 按约定未执行浏览器验证，也未修改 NeuroAgentHarness Core 或数据库 schema。

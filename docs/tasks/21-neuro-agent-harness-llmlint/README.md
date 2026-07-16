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

# AI 改写 agent 化：pi-ai 多轮工具循环逐处修改

> Task 18：用户提出「现在的 AI 改写是重新输出一次，效果不好。需要使用多个工具一条条的修改」，参考 NeuroBook 的 pi agent 模式（2026-07-10）。
> 上游：[Task 13 W7 llm_fix](../13-web-five-step-flow/README.md)、[Task 15 流式预览](../15-detection-workbench/README.md)。

## User Request + 三拍板

把 web「AI 改写」从整篇/整段重输出改造为 agent 模式：引入 pi 库（`@earendil-works/pi-ai`，依赖已在），给模型 replace/finish 两工具，多轮逐处做局部修改。

**拍板（2026-07-10，勿重议）**：① max-turns 耗尽但已有编辑 → 接受局部成果（diff 审阅人审兜底）；② 等待期预览改「编辑条目流」（逐条 oldText→newText+理由），旧 partial 全文流退役；③ **选区模式也 agent 化**（两模式统一）。

## 实施

**smoke 先行**：mimo 经 pi-ai `completeSimple` 多轮 toolResult（OpenAI role:"tool"）兼容性真调一次通过——3 轮各一个 replace（oldText 精确摘录）+ finish，方案可行后才动手。

**evals 侧（通用层，线 A 零动）**：
- `evals/generator/agent-loop.ts` 新建：`runAgentLoop(resolved, {system, user, tools, maxTurns, maxTokensPerTurn, execute, onTurn, callTurn?})`——维护 pi-ai messages（user / assistant 原样回填 / ToolResultMessage）；toolUse 逐个 execute 回喂；terminate → finish；stop 无工具 → natural-stop（成败交业务层）；连续 3 轮工具全错抛错止损。callTurn 可注入（单测无网）。
- `model-client.ts` 追加 `callModelTurn` + `classifyTurnOutcome`（旧代码一字不动）：每轮独立走 gate/重试；toolUse/stop 皆 ok，length/auth/溢出 terminal；**「没调工具」不在此层重试**（与 callModelForTool 单轮语义有意不同）。单轮墙钟 min(timeoutMs, 120s)。本地最小类型 AssistantBlock 补 `id`（toolCallId 关联）。
- `prompts.ts` 注册 `repair-agent-v1` / `repair-selection-agent-v1`（工具工作方式+oldText 唯一自纠指引；v1/v2/selection-v1 冻结）。`buildRepairUser`/`buildRepairSelectionUser` 加可选 closing 覆盖（缺省渲染逐字节不变——旧收尾「直接输出完整正文」与 agent 模式矛盾）。

**web 侧**：
- `web/server/utils/llm-fix-agent.ts` 新建：`applyReplace` 纯函数（0 命中/多命中/空/等同 四类错误文案即自纠指令）+ replace/finish typebox 工具 + `runRewriteAgent`（working 文本状态机，onEdit 同步写 job.edits；MAX_EDITS 封顶后提示 finish 不算错）。
- `llm-fix.ts`：`LlmFixJob.partial` 删除 → `edits: LlmFixEdit[]`；两模式改写调用委托 runRewriteAgent（full: maxEdits 30/maxTurns 36/每轮 4000 tokens；selection: 10/14）；守门换口径——0 edits 抛错、max-turns 有编辑接受局部成果、旧 0.5 字数比删除（局部修改天然不缩篇）。prompt 组装/批注两源合并/不落库契约全保留。
- `[id].get.ts` DTO：partial → edits（oldText/newText 各截 400 码点）。
- 前端：`useLlmFixFlow` llmFixStreamText → `llmFixEdits`（pending 轮询整段覆盖）；`LlmFixStreamPanel` 改条目流渲染（#序号+理由+红删绿增两行，贴底滚动）；AiFixPanel/contribute.vue 透传改名。**mergeLlmRewrite/dmp diff/LlmReviewBar/stale 校验/取消代数令牌 零改动**。
- `vitest.config.ts` 首建：alias `evals-generator`（tests/ 测 llm-fix-agent 需要）+ include 限定 tests/（防吞 evals 的 bun:test 文件）。

## Verification / Test

静态：web typecheck + typecheck:server 双 0 错误；vitest 124/124（+applyReplace 6）；bun test evals 49/49（+agent-loop 5）；eval.config.json / web/data.db 未动。

浏览器真跑（playwright，2026-07-10）：上传 291 字机器腔文本 → 跳过盲评 → AI 改写 tab 发起整篇改写 → **agent 5 轮 / 5 次工具调用 / 4 处编辑 / finish，43s，tokens 5267+1766** → diff 并入审阅横幅（已巡检 1/5）→ 编辑器内选区（setSelectionRange+mouseup）→ 选区菜单「AI 改写选区」→ **等待期条目流实时出现「已修改 1 处」+ #1 带修改理由** → 选区 agent 2 轮 / 1 编辑 / 12s → diff 并入。零 console 错误。日志确认通道 `prompt=repair-agent-v1+repair-selection-agent-v1`。

### 浏览器验收清单（接 Task 17 第 69 步）

70. AI 改写发起后等待面板标题「AI 改写进行中（逐处修改）」+「已修改 N 处」计数；条目逐条出现（理由 + 原文删除线红 / 改文绿）。
71. 完成后 diff 并入审阅横幅照旧（逐处接受/拒绝）；改动应明显更局部（不再整篇漂移）。
72. 选区改写同样显示条目流；完成后原位替换成 llm diff。
73. 取消/失败重试/stale 弹窗行为与改造前一致。
74. 英文界面（"AI rewrite in progress (edit by edit)" / "{count} edits applied"）。

## 与计划的出入

- llm-fix-agent.ts 做成通用核心 `runRewriteAgent`（full/selection 薄包装留在 llm-fix.ts），而非计划中的两个独立 rewrite*Agent 函数——避免循环依赖且少一份重复。
- full maxTurns 36（计划 32）：mimo 实测常态一轮一 replace，30 编辑 + finish + 自纠余量需 >31。
- 计划未列 vitest.config.ts；落地时发现根 vitest 裸跑无 include 会吞 evals 的 bun:test 文件（12 文件 7 失败），加 include 限定顺带修正。
- 走查中又踩 consent 开关坑（点了默认开的授权把它关掉致上传静默失败）——Task 16 已有先例，纯操作失误非产品 bug。

## TODO / Follow-ups

- [ ] 浏览器验收 70-74（主循环已 playwright 走查通过，用户可抽验）
- [ ] 单轮 120s 墙钟硬编码：换推理模型单轮长思考时配置化
- [ ] repair-agent-v1 是否进 evals 线 A repair 批跑（本轮只服务 web，跨模型对比另议）
- [ ] job 内存表重启丢任务（既有已知项，agent 化后单 job 时长变长，权重略升）

## 2026-07-11 report task profile 接入

整篇 agent 改写的问题清单现按构建期烘焙的 `ruleVerdicts` 精简：`noise/anti` 不再喂给 LLM，strong/weak、insufficient 与未测规则保留；report 缺失时降级为保留全量。该过滤只影响 Agent 的问题清单，不改变机器扫描、docScore、lift 或用户手动查看规则。

同轮把第一版报告中的 4 条 strong 规则从 namespace 默认 human 路由提升到 agent。指定典型正文在真正机械修复后保留 29 个 agent regex 候选，task profile 最终交给 LLM 23 个；旧流程则归零并触发“agent 桶为空，无需 AI 改写”。

## 2026-07-11 第二轮 creative profile

首轮 `ruleVerdicts` 过滤已升级为版本化 `creative-writing@1`。构建期同时应用 verdict 与稳定重叠规则抑制，服务端只消费 `creativeProfile.includedRuleIds`，不再自行重建筛选语义。report 缺失时保留全量规则，但仍抑制已确认的重复家族。

默认 semantic replace 已全部回落 manual，因此 Agent 清单不会再被“可点击删除/替换”提前消费。指定 `index2.md` 最终进入整篇 Agent 改写的创作候选为 17 处且重复 span 为 0；MachineScan 仍报告完整的 115 个静态命中。

与首轮记录的出入：4 条 strong 规则不再通过默认 candidate 获得应用权限；判别 verdict 只决定是否进入 profile。首轮 23 个候选是过渡口径，第二轮 17 个候选是当前正式口径。

## 2026-07-11 开发模式 job 轮询 401 修复

AI 改写 POST 能创建 job、随后动态 GET 却可能 401，并非 agent loop 或 job owner 判断错误，而是旧“免登录”中间件只覆盖静态 POST 路径。现在鉴权关闭时所有 endpoint 在 `requireCurrentUser` 上游统一解析为稳定本地开发用户，job 创建与轮询不再依赖 Cookie。隔离 API 回归确认不存在 job 返回 404 而非 401；本轮未做浏览器验证。

## 2026-07-11 Harness Port + 持久化 Chat Flow

内存 `llm-fix job` 与一秒轮询端点已退役。产品现在只依赖 `AgentHarnessPort`（`createSession/getSnapshot/invoke/abort/retry/subscribeEvents`），当前 `LocalAgentHarness` Adapter 使用 Prisma 持久化 `AgentSession`、append-only `AgentSessionEntry` 与 terminal `AgentInvocation`。该 seam 参考 NeuroBook `NeuroAgentHarness` 黑盒合同，但未直接 import sibling 源码，也未复制 Multi-Agent、approval、compaction 等无关能力；未来独立库发布后只换 Adapter。

每个 revision 自动建立 `llmlint.review` session：分析 invocation 完成后，同一 session 在 AI 改写 tab 继续对话。前端 snapshot 负责刷新恢复，SSE 只触发增量刷新；运行中 composer 禁用且 API 返回 409。每次改写携带当前真实草稿快照，最多 64 turns / 64 replace / 每轮 4000 tokens；整篇和选区统一进入 Chat，选区以引用附件预填要求，用户确认后发送。完成、取消后的 partial edits 均进入既有 diff 审阅，草稿在运行中变化则走 stale 决策。

服务重启会把悬空 invocation 标成 interrupted；retry 新建 invocation，不复活旧事实。旧 `web/server/utils/llm-fix.ts`、`/api/llm-fix-jobs/**`、`useLlmFixFlow.ts`、`LlmFixStreamPanel.vue` 已删除；`applyReplace` 仍作为 Harness optimize 工具的确定性核心保留。

与旧记录的出入：Task 18 首版 36/14 轮和内存条目流已被统一 64 轮持久化 timeline 取代；取消从“只忽略前端结果”升级为 AbortSignal 真正传播到 provider，已完成编辑不再丢弃。按要求未自动浏览器验证。

## 2026-07-11 NeuroBook SSE 核心子集与 Agent UI

前端名称从“AI 改写对话”统一改为“Agent”。没有直接复制整个 NeuroBook runtime，而是移植其 SSE 聊天核心合同：服务端发布 runtime/session 两类 envelope，进程级 `eventEpoch` + session 内单调 `seq` 支持游标恢复，保留 500 条 replay；连接握手用 `snapshotRequired` 明确是否需要全量恢复。Pi 的 assistant text/thinking、tool call 参数与结果、turn/agent 生命周期现在原样增量投影，前端 reducer 不再每个事件 GET snapshot；仅 seq gap、epoch mismatch 或 terminal 取 diff result 时刷新。

Agent timeline 现可看到流式正文、思考和工具卡；composer 只在 idle 可输入，运行中显示取消；自动贴底在用户上滚后停止抢滚动。该实现刻意不移植 NeuroBook 的模式切换、审批、Multi-Agent、compaction 等本项目不需要的能力，未来 Harness 抽库时保留现有 port 与前端状态机。

与计划的出入：原计划表述为“复制 SSE 聊天对话部分”，实际采用合同级核心子集移植，避免 sibling 源码耦合；同时将 Pi provider 从 `completeSimple` 切为 `streamSimple`，保证流式事件是真实模型增量而非前端模拟。验证同 Task 17 最新记录；未自动进行浏览器验证。

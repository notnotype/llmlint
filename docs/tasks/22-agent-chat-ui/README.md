# Agent Chat 界面适配

## User Request / Topic

在 llmlint 完成 NeuroAgentHarness hard cut 后，参考 NeuroBook 的 `AgentChatFlow.vue` 和 `AgentComposer.vue`，优化 `/contribute` 右侧 Agent tab 的消息流、工具展示和输入体验。

## Decisions

- 保留右侧 Agent tab 和 `AiFixPanel` 对外 props/emits，不改变页面信息架构。
- 本轮只适配界面，不开放运行中 steer/follow-up；运行中仍只能停止。
- 不复制 NeuroBook 的模型选择、模式切换、token/cost、消息编辑、分支、历史分页和 workspace changes。
- Assistant、thinking 和 Tool Result 使用安全 Markdown：`marked` 负责解析，`DOMPurify` 使用 allow-list 清理；原始 HTML、事件属性和危险协议不进入 DOM。
- 按项目约束不自动进行浏览器验证。

## Implementation

### Flow / Composer 边界

- `AiFixPanel` 收缩为编排层，内部由 `AgentChatFlow` 和 `AgentComposer` 分别承担历史与输入。
- Flow 按 durable Invocation 分段，显示 analysis/optimize、turns、running/completed/partial/failed/aborted/interrupted 状态及错误。
- user/assistant、thinking、tool、edit group 和 report 使用独立节点；连续 edit 合并为“已修改 N 处”，Tool 默认折叠参数与结果。
- Composer 将选区引用、输入框、外部 LLM、展开、retry 和发送/停止收进统一输入卡片；连接和 run phase 作为紧凑状态行。
- 自动吸底使用 `requestAnimationFrame` 合并；用户上滚后不再抢滚动，Session 切换后重新定位底部。

### 前端投影修正

- durable Tool Call 与 Tool Result 现在合并为同一工具节点，刷新后不再重复显示；Tool Result 缺少 args 时不会用 `{}` 覆盖原 Tool Call 参数。
- report timeline 保留完整 score/confidence/suggestions，Flow 不再只能显示 conclusion。
- retry 只认最新 Invocation；较早失败但后续 retry 已成功时不再错误显示重试按钮并触发 HTTP 409。

### Markdown 与依赖

- web 新增 `marked@18.0.6`、`dompurify@3.4.12`；根测试依赖新增 `happy-dom@20.10.6`。
- Markdown allow-list 只接受常用正文、列表、引用、代码、表格和链接元素；链接仅保留 http/https/mailto/相对地址，并补 `target=_blank` 与 `rel=noopener noreferrer`。
- DOMPurify 实例按 Window 缓存，避免流式 token 更新反复初始化 sanitizer。

## Verification / Test

- 新增 `agent-chat-flow.test.ts`：Invocation 分段、tool/edit 节点、工具摘要、terminal tone、latest retry 语义。
- 扩展 `agent-chat-projection.test.ts`：Tool Call/Result 恢复合并、args 保留、完整 report 投影。
- 新增 `agent-markdown.test.ts`：Markdown 正常渲染及 script/event/javascript URL 清理。
- 全量：224 tests / 760 assertions。
- 根 typecheck、web client/server typecheck 全部通过。
- Nuxt production build 完成；只有既有 sourcemap、chunk size、第三方 ESM/exports warning。新增 Markdown sanitizer 位于约 173KB client chunk，未制造新的超阈值主 chunk。

## Browser Checklist

1. 2048×1017 下 Agent tab 不再出现重复标题栏，Flow 与 Composer 层级接近 NeuroBook。
2. 360–960px 右栏宽度内 user/assistant、tool args、edit diff 和 report 不横向溢出。
3. thinking/tool/edit group 展开折叠正常，Markdown 列表、代码、链接样式正常。
4. 流式输出贴底；用户上滚后停止抢滚动；Session 切换后定位底部。
5. 选区引用、发送、停止、最新失败 retry、外部 LLM、连接与 run phase 状态正常。
6. 中文和英文文案完整。

## 与计划的出入

- 计划只列 Flow/Composer/Markdown 三层；实现额外拆出轻量 `AgentToolNode`，因为 Tool 的折叠、状态、参数与结果已形成独立可测试视觉单元，不继续堆回 Flow。
- 走查时修复了两个既有恢复问题：Tool Result 覆盖 args，以及较早失败 Invocation 错误暴露 retry。两者都属于新界面依赖的投影合同，不是临时 UI hack。
- 未执行自动浏览器验证；Browser Checklist 留给用户后续验收。

## 2026-07-19 完整 Transcript、Cancel 与一键修到底（历史，固定顺序已被 2026-07-20 替代）

- Chat Flow 现在展示每轮实际 System Prompt、用户原始要求和 Core durable `agent.message.role=user` 模型输入；三者使用明确标签，刷新后不会丢失或错误去重。
- 工具卡适配新 `read/edit/lint_check/lint_fix/get_detection_heatmap/finish` 名称。
- Cancel 点击后立即进入本地 aborting，按钮禁用；请求携带 active invocation ID，只由 SSE terminal 或 snapshot recovery 清理运行态。
- “一键修到底”不再发送泛化润色要求，而是固定编排 read → CLI 同构 lint_check → 逐检测器 heatmap → safe lint_fix → 复扫 → edit → 最终复扫 → finish；summary 必须按行号说明已修和未修问题。

全量 21 files / 181 tests passed；双 typecheck 与完整 Nuxt production build 通过。按项目约束未自动进行浏览器验证，仍需人工确认长 System Prompt 折叠、Cancel 终态和真实模型工具顺序。

## 2026-07-19 Cancel terminal race 修复（历史，full_repair 已被结果目标替代）

- Abort API 返回 `aborting` 时继续等待 SSE terminal；返回 `idle` 表示 terminal 已先发生，前端立即拉取 durable snapshot 清理本地 aborting。
- 取消请求失败仍恢复本地状态并显示通知；重复点击继续由 `abortRequested` 门禁。
- 一键修到底现在除固定用户指令外，还发送显式 `workflow="full_repair"`，工具顺序由 Profile 合同约束，不再只依赖模型遵循自然语言。

新增纯状态回归测试覆盖 abort idle recovery；本轮未自动执行浏览器验证。

## 2026-07-19 一键入口与 length 失败说明

- 顶部“一键修到底”不再由宿主预应用静态修复；全部修改统一由 Agent `lint_fix/edit` 产生 durable edits。
- 按钮说明与固定指令改为读取当前草稿、版本检测记录和带行号实时报告。
- provider `length` 失败在 Chat Flow 中显示为“模型本轮输出达到上限，可重试”，未知错误仍保留原文。
- 工具卡使用 `get_revision_detections`，不保留旧 `get_detection_heatmap` 名称。

## 2026-07-19 公开 Chat 边界、实时草稿与 Review 收口

- Agent Flow 只展示 `llmlint.request` 的真实用户输入、Assistant、工具、edit/report 和 Invocation 状态；System Prompt 与 Profile 包装后的 `agent.message.role=user` 继续 durable 保存并送入模型，但不再伪装成公开聊天消息。
- optimize 的每条 durable workspace 会立即以现有 llm diff 语义写入左侧正式修复稿；terminal 不再重复整篇 merge。aborted/failed 已产生的 partial edits 保留，workspace 与当前草稿不严格衔接时停止覆盖并进入 stale 决策。
- Agent 运行期间正文只读，静态修复、格式化、替换和选区改写入口关闭；滚动、选择和复制保留，程序化 workspace 更新不受只读限制。
- 外部检测器继续使用有限轮询；LLM Review 不再被同一个 120 秒上限截断。任一 Analysis terminal 或 snapshot 恢复终态都会按 invocation ID 幂等刷新当前 Revision 的 machine projection，`hits=[] / score=0` 同样恢复为 completed。
- repair prompt 升级为 `repair-agent-v3`，工具轮直接调用工具，不复述用户要求、已完成步骤和工具结果。

验证：仓库全量 22 files / 197 tests、根 typecheck、web typecheck 通过。production build 已完成 client/SSR 编译并进入 Nitro server 打包，但在当前 3001 自动重启 dev 实例并存时长时间无输出，手动终止该构建进程；没有把它记录为通过。

与计划的出入：没有为 164 秒历史样本实际等待 164 秒做慢测试，而是在 terminal callback、snapshot recovery 和 detector-only poll 边界分别建立快速确定性回归；真实长耗时仍留给人工/真实 Pi 验收。未自动执行浏览器验证。

## 2026-07-20 完整运行上下文恢复

上一轮把 System Prompt 与 Profile 构造的首条 model input 从公开 Flow 完全过滤，导致 Analysis Invocation 在界面上直接从 Assistant/Tool 开始，无法查看实际送模上下文。durable entries 和 SSE 均未丢数据，问题只在前端投影。

- System Prompt 恢复为默认折叠的独立节点。
- `agent.message.role=user` 的内部输入恢复为“模型输入”节点。
- `llmlint.request` 继续作为唯一标记为“你”的真实用户输入；内部输入不再伪装成用户气泡。
- live SSE 与 snapshot refresh 使用同一来源投影规则。

这次调整保留完整 transcript 可观察性，同时通过来源标签解决此前两个用户消息难以区分的问题。

验证：投影/Flow 专项 14 tests、仓库全量 22 files / 198 tests、根 typecheck、web typecheck 通过。未自动执行浏览器验证。

## 2026-07-20 多 Revision Chat 生命周期收口

- 同一 Text 的线性 Revision 共用 head Session，Chat transcript 与 SSE cursor 跨版本连续；每个 Invocation 自己的 `revisionId` 决定报告刷新目标。
- `useAgentChat` 统一拥有 optimize、analysis、abort 与 SSE 生命周期。历史 Analysis 重试走当前 head Session；Analysis cancel 在刷新 snapshot 后只取消 phase/revisionId 精确匹配的 active Invocation。
- “一键修到底”始终发送全文 scope 和 `objective=eliminate_rule_hits`，不会携带 Composer 残留选区；普通消息继续携带当前选区。
- Optimize 不再使用固定工具顺序或“先读/先 lint 才能 edit”的 UI/Profile 门禁。Chat Flow 继续展示 System Prompt、标记为“模型输入”的内部 user-role 消息、真实用户要求、Assistant、工具与结果。
- machine 有限轮询只负责外部 detector 和发现异步创建的 Agent Session；LLM Review 超过 120 秒仍由 Session SSE/snapshot terminal 刷新，不会被 detector 上限提前截断。

本节替代上面的固定编排与 `workflow=full_repair` 描述；浏览器验证仍按项目约束等待用户授权。

## 2026-07-20 历史恢复 abort 与风险润色入口

- 历史打开后不再自动 reveal 或启动 Analysis；恢复会定位 lineage 最新已知 Session，重新读取 snapshot，并终止其中的 active Invocation。
- 跨篇清场会同步重置上一 Session 的 local invocation/aborting/run phase，防止旧取消状态吞掉新历史 Session 的 abort 请求。
- 未揭示 head 在左侧保持只读，版本条显示“检测未完成 / 继续检测”；只有用户显式点击后才 reveal 并启动 Analysis。
- 一键入口改发 `objective=polish_ai_risk` 和风险分层指令：strong/AI 敏感词必修，weak 酌情，高风险区域允许整句或整段润色；内部多候选后选择最不符合模型惯用偏好的合格方案。
- 一键入口在 POST Invocation 前同步应用当前 auto 静态修复，并以更新后的草稿/repair plan 建立 Agent 输入；`polish_ai_risk` 不暴露 `lint_fix`，因此 Chat Flow 不再出现 Agent 未读正文先调用机械修复的尴尬步骤。普通聊天的 `lint_fix` 能力不变。

本节替代上方 `objective=eliminate_rule_hits` 与全规则清零描述。

验证：`useAgentChat` 9 条公开行为覆盖全文/选区意图、一键 auto 修复先于 POST、历史 Analysis head Session、精确取消、Session 切换即恢复和跨篇 abort 状态清场；Profile 回归确认 `polish_ai_risk` 不暴露 `lint_fix`，普通 optimize 保留；仓库全量 34 files / 290 tests、双 typecheck 与 Nuxt production build 全部通过。

与计划的出入：前端 machine 轮询仍保留单个有限函数，但退出条件改为“detector 已收口且 Agent Session 已发现”；它不等待 LLM Review terminal。测试归入 `web/tests/nuxt/`，使 Nuxt 类型由 Web tsconfig 负责。未自动执行浏览器验证。

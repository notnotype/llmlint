# Project Status

## Summary

llmlint 是针对 LLM 生成中文文本的 linter：CLI 用正则确定性定位「AI 味」候选，Agent Skill 读上下文判断并在用户审批后改写。当前版本 **2.0.0**，已从 neuro-book 内嵌 skill 拆分为独立开发仓（真相源 = 本仓，`github.com/notnotype/llmlint`）。

**体系定位（2026-07-02）**：中心资产是**大规则库**（超集，规则只有"对某任务好不好"）。四环 = ① 规则选择（evals → task profile）→ ② 评价获取（web：llmlint + 外部 AIGC 检测器双路首检 + 人类盲评）→ ③ 规则整理（NL 标注 → 规则增补入库）→ ④ 应用验收（改文后检测概率降**且**人评不降，D5）。外部检测器是地基不是对手。详见 [CONTEXT.md](CONTEXT.md) §1/§3。

## 核心规范（权威文档）

> eval 是本项目最核心的部分；方法论与术语是一等规范，代码按它实现。

- [CONTEXT.md](CONTEXT.md)：领域语言（术语）+ 硬不变量 I1–I23。
- [evals/METHODOLOGY.md](evals/METHODOLOGY.md)：评测方法论 / 流程规范（代码遵守它，冲突以它为准）。

## Architecture

- 仓库根是开发工作区（name=`llmlint-dev`），承载 `skill/`、`evals/`、`tests/` 和开发脚本。
- `skill/` 是可安装、可发布的 runtime 包（name=`llmlint`）：`bin/llmlint.ts` + `src/`（config / rules / scanner / reporter / markdown-mask / cli）+ `rulesets/builtin/default/` + `references/` + `SKILL.md`。
- `evals/` 是判别力评测 harness（consumer + generator + acquire），进 git 但不进 `skill/`；语料合规边界见 `docs/tasks/03-llmlint-eval-harness/data-acquisition.md`。
- `web/` 是单 Node Nuxt 采集站（`ssr:false` 保留）：构建期把完整规则 catalog + 默认 active registry 预烘成 `registry.json`，浏览器按本地设置覆盖调用纯函数 `materializeRules`，再用 `scanText`/`computeMaskedRanges` 本地检测；Nitro server 提供配置式鉴权（开发默认关闭登录并使用稳定本地用户，生产默认启用 `nuxt-auth-utils` session）、Prisma 7 + libSQL 持久化、`/contribute` 盲评采集、服务端机器信号全通道落库、span 自然语言标注和管理员导出。部署形态为 `nuxt build` + Node 宿主。
- web 的 LLM 分析/改写只依赖深 Module `AgentHarnessPort`，唯一实现为公开包 `@notnotype/neuro-agent-harness@0.1.0`。llmlint Adapter 提供 Prisma SessionStore、Pi ModelRuntime、analysis/optimize Profile、MachineLlmReviewProjector、权限和 SSE DTO；Core 直接提供 cursor/replay，不再经过第二层 EventBus。Store 使用进程级 per-session queue并明确只支持单 Node + SQLite；libSQL 连接容忍有限外部 busy lock，projector 只补缺失 review，startup reconcile 顺序且防重入。SSE route 由请求级生命周期统一关闭 heartbeat、Core subscription、forward task 与 H3 writer。历史 Session 由 `bun run agent:migrate-neuro` 显式备份、按 ledger 重建、重跑 analysis 后 hard cut。
- `/contribute` Agent tab 展示完整可观察 transcript：System Prompt 使用折叠节点，Profile 内部首条 user-role 消息标记为“模型输入”，只有 `llmlint.request` 标记为“你”；Assistant、工具、edit/report 与 Invocation 状态正常展示。Composer 统一承载选区、输入、外部 LLM、retry、发送/停止与连接状态。Cancel 绑定 active invocation ID 并等待 SSE terminal；durable workspace 经 SSE 实时写入只读中的正式修复稿，断线可由 snapshot 恢复。Assistant 内容使用 `marked + DOMPurify` 安全 Markdown。
- `/contribute` 报告为三维“AI 痕迹风险”：规则引擎、外部检测、LLM Agent 并列，越高越可疑、绿→黄→红；综合风险仅作次级参考（30%/45%/25%，缺失通道重新归一）。一条线性 Revision lineage 复用同一 Agent Session，Session revisionId 是当前指针，Invocation revisionId 是运行归属真相。`RevisionTextWorkspace` 暴露 `read/edit/lint_check/lint_fix/get_revision_detections`；历史 Revision 只读，current 工作副本结果统一进入 diff 审阅。
- LLM 评审使用 `llm-rules-agent-v6`，Optimize 使用 `repair-agent-v5`。一键修到底先由宿主应用 `fixability:auto` 静态修复，再以更新后的草稿声明 `objective=polish_ai_risk`；该 Invocation 不暴露 `lint_fix`，避免模型未读正文先改工作副本。强判别与当前启用的 `vocabulary.*` AI 敏感词是必修，weak/LLM Review 结合语境处理；eval report 缺失时安全降级为 contextual。Agent 可对高风险句段做小范围整体润色，并在内部多候选中选择最不像模型惯用表达的方案。历史恢复不会启动工作，跨篇状态清场后已有 active Invocation 会按 ID abort，未揭示 head 等待用户显式“继续检测”。正文只经 `read` 进入模型上下文；单轮输出预算按模型上限计算并封顶 65,536。
- 运行时：**Bun 原生** 或 **Node + tsx**；裸 `node` 因无扩展名 TS 相对导入不可直接运行。依赖装在 `skill/` 内自包含（commander / node-fetch-native / picocolors / tinyglobby）。

## Rules / CLI Facts

- 默认无 config 时加载单一内置 ruleset `builtin/default`：约 **360 rules / 287 active**，跨 50+ namespaces，由人工基础规则、中文策展规则（shuorenhua / avoid-ai-writing / humanizer）与 story-deslop 校准检测器合并生成。
- 三个正交维度：`level`（high/medium/low，严重度+退出码）、`review`（agent/human/none，审查受众，`check` 默认 `--review agent`）、`fixability`（auto/candidate/manual，机械修复能力）。默认 review 桶为 agent=96 / human=188 / none=3；默认 regex 规则为 auto=3、candidate=0、manual=263；`action.replace` 只是替换模板，不授予应用权限。
- 配置三层覆盖：rule id > namespace > ruleset > rule 默认；字符串是对象覆盖的语法糖，config 一处去糖、消费端无分支 patch。
- 规则模型 v3 已落地：`scope.layer` 支持 narrative/dialogue/all 等长视图，`ignoreTerms` 统一遮罩 regex/density/handler，density detector 负责全文/段落分布指纹，builtin handler 负责 not-is 状态机、碎句号、过度精炼、低连接密度和引号强调；CLI、web 本地扫描、服务端 MachineScan 与 Agent `lint_check` 均消费同一份预烘静态规则。未知 detector/handler 按 warning 优雅跳过。
- `check` 支持多文件/glob/目录、Markdown 遮罩（代码块/frontmatter/链接不误杀）、regex+density+handler 静态扫描、`--min-level` / `--review` 过滤、stylish（TTY 上色）与 `--format json`。
- `fix` 只做 `fixability:auto` 机械修复（零宽字符 + 连续符号去重），默认 dry-run（有待修退出 1，可做 CI 门禁）、`--write` 落盘；语义修复仍由 Agent 读上下文、经用户审批执行。
- `status` / `config` 提供用户级 `~/.llmlint/settings.json` 初始化门；`detect` 直连 HF Space `yuchuantian-aigc-text-detector.hf.space`，句界分块、代理分流、content-hash 缓存，并输出 chunk 热区。
- Web 同样严格区分修复权限：一键机械修复只吃 auto；默认 semantic replace 全部 manual，candidate 只保留给用户配置的显式白名单。构建期 `creative-writing@1` profile 直接消费 holdout report，排除 noise/anti 与稳定重复家族；MachineScan 和原始 eval 仍扫描完整超集。

## Recent Tasks

| Task | Status | Notes |
| --- | --- | --- |
| [23 Skill 闭环与服务接入](docs/tasks/23-skill-loop-and-service/README.md) | 分片 1 A/B Done / 规则整理进行中 | B 线已提交 `0d8b7f3`：handler 管线测试、用户状态层、`status`/`config`、`detect`、缓存与验证闭环。A 线完成 story-deslop 校准规则导入、namespace 策略、校准测试、SKILL.md 五步流程、repair-guide 与规则模型 v3 不变量文档；后续规则整理已默认关闭稳定重叠旧规则和素材通配符转换遗留（含占位比喻壳），并把题材词表、宽泛低信号规则、普通开场连接词、裸词级规则、旧单层否定对比、裸嘴角弧度、宏大时代开场、弱新颖性拔高、普通动作音效尾句和两个过时 modifier strong override 下沉 human，`few-degree` 撤回 Agent 例外，裸“近乎”从 Agent 规则中移除，泛否定转折规则转 human，`opening.cliche` 限制到叙述层文首窗口，`quote-emphasis` 保持 human advisory；最近继续收窄 `unquestionable-claim`、`trailing-sensory-clause` 与否定连排 only-turn 重叠。分片 2 contributions 与分片 3 登录仍未做。 |
| [22 Agent Chat 界面适配](docs/tasks/22-agent-chat-ui/README.md) | Implemented / Browser Pending | Flow 展示可区分来源的完整运行上下文；同 Session 跨 Revision 保留 transcript/cursor；历史 Analysis 重试与取消由 `useAgentChat` 按 Invocation revision 收口；一键入口先应用 auto 静态修复，再把更新后的草稿交给不含 `lint_fix` 的风险润色 Agent。最终全量 34 files / 290 tests、双 typecheck、Nuxt production build 通过；浏览器验收待用户授权。 |
| [20 AGPL-3.0-only 许可证迁移](docs/tasks/20-agpl-license-migration/README.md) | Implemented | 根开发仓和可安装 `skill/` package 已迁移到 AGPL-3.0-only，并同步刷新 NeuroBook vendored/user runtime 的许可证、README 与 manifest；NeuroBook 聚焦同步测试通过。 |
| [21 NeuroAgentHarness llmlint Adapter](docs/tasks/21-neuro-agent-harness-llmlint/README.md) | Complete / Runtime Hardened | 公开 Harness hard cut 保持；同一线性 Revision lineage 复用 Session，Invocation revisionId 作为归属真相；`RevisionTextWorkspace` 统一 read/edit、CLI 同源 check/auto fix、历史只读 Revision 与三路持久检测。幂等 advance、精确读取覆盖和规则结果清零均已回归；业务能力仍留在 llmlint Adapter/Profile，不进入 Core。 |
| [01 anti-ai-slop / llmlint skill](docs/tasks/01-anti-ai-slop-skill/README.md) | 历史 | llmlint 源头（原名 anti-ai-slop）：TypeScript+正则、static/llm 分层、6 步润色流程、CLI 与参考文档、2026-06-28 硬切重命名。 |
| [02 llmlint Rule Registry](docs/tasks/02-llmlint-rule-registry/README.md) | Implemented | flat Rule Registry（id/namespace/ruleset）、三层覆盖、review/fixability 维度、rules 目录递归加载、CLI `fix`+多文件+Markdown 遮罩；2026-07-11 第二轮收紧为默认 auto=3/candidate=0，并以版本化 creative profile 收敛 8 条稳定重复规则，不删除全局规则资产。 |
| [03 llmlint Eval Harness](docs/tasks/03-llmlint-eval-harness/README.md) | M1–M3-B Done | 判别挖掘 harness：配对 lift、docScore ROC-AUC、模型排名、误杀率、默认 40% holdout 与 overlap 重复率；正式 test AUC 0.807，creative profile test AUC 0.990、重复率 11.1%。 |
| [04 llmlint Standalone Repo](docs/tasks/04-llmlint-standalone-repo/README.md) | Implemented | 从 neuro-book 内嵌 skill 拆为独立开发仓：仓库根开发工作区、`skill/` 可安装包、`evals/` 进 git。 |
| [05 Web Frontend](docs/tasks/05-web-frontend/README.md) | Implemented | 纯客户端检测网页（Nuxt 4 SPA）：本地 `scanText` 检测、分组/过滤/规则详情/Markdown 遮罩、**首页双状态输入→分屏动画**、**行内高亮**、**列表↔正文双向点击定位**、**一键机械修复(auto 桶,含撤销)** + **复制 JSON**、**首屏 About 说明** + **评测报告查看器(内置示例报告预烘)** + **GitHub Pages 部署 workflow**(baseURL/meta/favicon) + **轻量主题/i18n/设置弹窗/规则覆盖配置**。机械修复逻辑抽到共用 `skill/src/fix.ts`，规则 materialize 抽到 `skill/src/rule-registry.ts` 供 CLI/Web 共用；设置审查已补齐 namespace 级 level/review/fixability 覆盖，收紧 `review:"all"` 只用于过滤，复制 JSON 隐藏统计按 CLI 顺序计算。vue-tsc 0、核心测试通过；本轮 `nuxt generate` 编译过但 `.output` 被现有 dev 进程锁住导致 rmdir EBUSY。 |
| [06 Web Data Collection](docs/tasks/06-web-data-collection/README.md) | V1 Implemented | 检测数据 web 采集（判定标签，category ③）：`web/` 已升级为全栈 Nuxt，新增注册/登录、默认公开只 gate `/contribute` + 写 API、Prisma schema + 初始化 SQL、上传正文、盲评两轴、浏览器扫描后揭示报告、MachineRecord(engineVersion)、span NL 标注、管理员导出。数据喂评测第②层与规则精度，**不进 lift**。 |
| [07 Web Review Editor](docs/tasks/07-web-review-editor/README.md) | V1 Implemented | 规则审查编辑器第一版：新增专用 `ReviewEditor`，保持单一 Markdown 文本真状态；source 模式继续使用精确 textarea/UTF-16 offset；preview 模式引入 TipTap 渲染 Markdown；批注以当前审查 session sidecar 保存，不污染原文；`fixability:auto` 的确定性正则替换可在正文预览并单条应用，preview 与 source 背板都会显示 replacement/delete 提示，单条替换会给出可恢复文本和批注快照的撤销通知，右侧报告列表也可对 auto 命中就地替换/删除并复用同一撤销链路，替换后会自动衔接到后续剩余命中。已补 TipTap 风格 inline selection menu（批注/复制/定位源码/单条替换），菜单在选区命中规则时会直接显示级别、规则标题与处理状态；source/preview click-outside 与 `Escape` 选区菜单收尾、全文上下文单条替换和批注范围变换；真实 NeuroBook manuscript 链路验证 scanner/web registry 正常，首页提交新文本或工作台内换新长文档时若旧过滤器会隐藏所有命中，会自动放宽到全部命中；汇总条和主列表会区分“过滤隐藏”和“本地规则覆盖关闭默认命中”，规则设置导致页面看似无命中时会提示并提供恢复默认规则入口；批注 rail 新增未处理/总数与完成/重开状态，source/preview 标记会弱化已完成批注，preview 正文 mark、source 背板 mark 与 rail card 共享序号徽标，source 点击批注范围也会打开 rail 并激活对应卡片，当前命中也可不重新框选直接添加批注，批注栏可优先在未处理批注间前后巡检；最近记录与本地 sidecar 批注已打通，删除/清空历史会同步清批注，普通长章节重开不会因旧 10k 截断导致批注丢失；顶部审查状态条会显示命中/可替换/批注状态并支持收起批注栏，左侧工具条可按当前过滤结果上一处/下一处连续巡检命中，右侧报告会同步高亮具体 active 命中行且折叠时仍补出当前行；source/preview inline 批注入口已升级为支持保存/取消与快捷保存的多行表单；preview source-range 和 selection 映射改为优先按出现序号绑定，降低 Markdown 语法前后重复文本错绑风险，并允许常见重复文本直接在 preview 精确批注；在未接 LLM 前，汇总条提供醒目的 `外部 LLM` 下拉导出，可复制“不带正文”或“带当前正文”的优化 prompt，prompt 明确要求外部 LLM 保持 Markdown 并只返回优化后正文。`bun test tests/llmlint.test.ts`、`bun run typecheck`、`bun run build` 和 Playwright 链路通过。 |
| [13 Web 五步通路 UX+Schema](docs/tasks/13-web-five-step-flow/README.md) | Spec + W1 Implemented | web 通路（采集线 B）权威规格 + W1 落地（2026-07-07）：五步流程 UX 状态机 + Task 12 目标 schema + API 面，四项拍板（`Revision.revealedAt` 揭示显式化、分类三值三源、机器信号一律服务器算、report verdict 烘进 registry 供强判别静态替换）。W1：schema 迁移（origin 三变体 / 拆 MachineScan+MachineDetect / DocJudgment 四维可选）、服务端扫描通道（engineVersion=`2.0.0+r{hash}` 单源、docScore 对齐 evals 口径）、reveal/machine 端点（未揭示 403 = D2 服务器强制）、blind 新规则、废除 `/api/scans`、export 适配；34/34 API 闭环断言 + 双 typecheck 绿。W2–W6 全部落地（2026-07-08）：W2 五步 UX 完形（自报三项/盲评可跳过/复评四维/多轮循环 head 追踪/verdict 烘焙 strong 过滤——**发现 strong∩auto 当前为空集**、7 条 strong 全 candidate，一键机械清理近不可见属预期/span 标注组件/中英 i18n 还清 Task 10 R2；35/35 断言）；W3 外部检测器服务端腿（HF 走代理 `node-fetch-native/proxy` dispatcher、异步 waitUntil 写 MachineDetect 含热力图 chunksJson、真跑 docPAi 0.9991、失败优雅缺省、D5 检测概率腿升级/降级双口径）；W4 `llm_fix`「AI 改写」任务式端点（mimo + 复用线 A repair-v1 链，真跑 57s 命中 84→48 / docScore 38.2→29.4）+ provenanceJson 逐规则 hunk；W5 lift 闸门谓词双侧代码化（report.json 逐字节零漂移）+ export `liftAdmissible` 标记 + corpus 导入脚本（curated 5/generated 30/repair 3 血缘幂等、visibility 强制 private 守 I11）；W6 上传后异步 LLM 分类补空（mimo 真跑、只补空防覆盖原子写实测、失败静默）。最终合并态 evals 42/42 测试 + 三重 typecheck 全绿；**浏览器手动验收清单 17 步在 walkthrough 执行记录，待用户一次性验收**。 |
| [14 线 A 修复一轮循环](docs/tasks/14-line-a-repair-loop/README.md) | Implemented | llm render helper 通路（M4 repair 部分，2026-07-07）：`repair-v1` 版本化提示词 + `repair.ts` CLI（断点续跑/拒答守门/限流预算复用）+ meta 契约加 `repairOf` 血缘 + `report.repair` 配对统计（不触 lift/AUC 任何路径，零漂移验证）。5 对真实验证（修复者 deepseek）：docScore 中位 25.32→19.58（5/5 改善）而神经检测器 P(AI) 中位仅 −0.7pp——**表层规则一轮修复撼不动神经检测器**，D5 双条件反 Goodhart 的正向实证。39/39 测试绿。 |

Task 07 latest supplement（2026-07-03）：工作台左右面板支持拖拽调整宽度并持久化；最近历史改为精确正文恢复并过滤旧截断记录；静态单条替换、顶部一键机械清理、source/preview 选区剪贴板替换、source/preview 选区 Markdown 加粗/斜体/删除线/行内代码格式化（含 Ctrl/Cmd+B、Ctrl/Cmd+I、Ctrl/Cmd+Shift+X、Ctrl/Cmd+` 快捷键和专属格式化通知）、source/preview 选区块级 Markdown 引用/无序列表/有序列表/围栏代码块格式化（既能识别/解包 ```，也能识别/解包 ~~~，新增代码块规范输出为 ```；选区支持 Ctrl/Cmd+Alt+0/1/2/3 切段落/标题，Ctrl/Cmd+Shift+7/8 切有序/无序列表）、source/preview 文本块样式面板（段落、标题 1/2/3、无序列表、有序列表、引用、代码块；标题/列表/引用之间互斥转换，不会叠出 `- ## 标题` 或 `### > 引用`；列表项可用 inline 菜单或 source 模式 `Tab` / `Shift+Tab` 增加/减少缩进来调整嵌套层级，非列表段落不会被 Tab 误改；段落会移除标题/列表/引用/围栏代码块等块结构但保留 inline Markdown；当前区块图标会随选区状态更新，选中围栏代码块内部也能识别为代码块；preview 写回 source）、source/preview 选区 Markdown 链接格式化（内联 URL 表单，可用 Ctrl/Cmd+K 打开；已有链接会预填当前 href，支持 `<...>` angle destination 中的空格/括号 URL和普通 destination 中的平衡括号 URL，更新已有链接会替换整个 link wrapper 而不嵌套，可直接移除链接并保留 label，也可只更新 destination；preview 只读链接选区会同步 DOM selection 到 ProseMirror selection）、source/preview 选区批注表单可用 Ctrl/Cmd+Alt+M 打开并保存到同一批注 rail，批注 rail 可用 Ctrl/Cmd+Alt+J/K 在未处理优先队列中前后巡检，并用 Ctrl/Cmd+Alt+D 完成/重开当前批注、source/preview 选区清除 Markdown 格式（可用 Ctrl/Cmd+\；单行普通内联选区只清当前 wrapper，跨行或块结构选区才清标题、引用、列表、围栏、链接、行内代码、粗斜体、删除线等 Markdown 原生标记）、source/preview inline 菜单会基于同一个 Markdown source-range 状态点亮当前格式按钮（标题、粗斜体、链接、删除线、代码、引用、列表、围栏），外部 LLM 全文剪贴板替换都会生成 sidecar diff 标注，source/preview 都能显示删除线旧文本和新增标记，零宽字符删除会显示为可读标签，撤销会同步恢复正文、批注和 diff；preview 结构性格式化会先收起 BubbleMenu 再在下一 tick 替换 Markdown，避免菜单卸载与 ProseMirror 文档重写撞出 Vue DOM patch 错误；source/preview inline 菜单在移动端会按视口宽度收口并换行，不再因按钮增多越界。用户可以用 toolbar 的上一处/下一处修改逐条巡检 diff，也可以用 Ctrl/Cmd+Alt+N/P 巡检下一处/上一处修改、Ctrl/Cmd+Alt+Enter 清除当前修改标注，也可以直接点击 preview 正文里的删除线/新增 diff 标记来选中该修改，再在 source/preview 中单独清除当前激活的修改标注并撤销清除，清除标注不回滚正文。全文替换 diff 使用行级 LCS，并规范化 CRLF/LF，避免 Windows textarea 换行导致未改行被误标。未接入 LLM 前，除全文指令外，当前 active 命中可一键复制“命中 + 上下文 + 相关批注”的局部优化指令；source/preview inline 选区优化指令现在也会携带邻近上下文和相关用户批注，并明确要求外部 LLM 只返回选中片段；批注卡片可复制“原文片段 + 批注 + 状态”的上下文，方便交给外部 LLM 或人工 reviewer。编辑器、外部 LLM 菜单、最近历史、右侧报告列表、规则详情弹窗、设置弹窗、Header 登出通知、登录/注册页、汇总条、过滤条和 LLM 规则提示的界面 chrome 已补齐 zh-CN/en-US i18n，规则标题与正文仍按内容原样显示。分屏 diff 与真实 LLM 修改链路仍作为后续设计。

Task 07 latest supplement addendum（2026-07-03）：批注 rail 的键盘审稿流继续补齐，当前激活批注可用 Ctrl/Cmd+Alt+E 打开现有编辑表单并聚焦输入框；保存、取消仍复用原有 rail 编辑路径。

Task 07 latest supplement addendum（2026-07-03）：`Ctrl/Cmd+Alt+M` 的批注快捷键现在会优先批注当前 source/preview 选区；没有选区但存在 active issue 时，会打开当前命中的批注表单，避免用户从右侧报告定位命中后还要重新框选正文。

Task 07 latest supplement addendum（2026-07-03）：当前 active issue 的外部 LLM 局部优化指令可用 Ctrl/Cmd+Alt+L 直接复制，复用原 toolbar 按钮的 prompt 构造、相关批注上下文和剪贴板通知路径。

Task 07 latest supplement addendum（2026-07-03）：当前 active issue 若存在确定性静态替换/删除，可用 Ctrl/Cmd+Alt+R 直接应用；快捷键复用原 `acceptReplacement()` 路径，保留 diff 标注、批注范围变换和撤销通知。

Task 07 latest supplement addendum（2026-07-03）：命中巡检补齐键盘入口，TextPanel 现在支持 Ctrl/Cmd+Alt+ArrowDown/ArrowUp 在当前过滤后的可见命中中前后移动，复用原上一处/下一处命中按钮的 `navigate-issue` 路径。

Task 07 latest supplement addendum（2026-07-03）：外部 LLM 局部指令快捷键 Ctrl/Cmd+Alt+L 改为选区优先；当前 source/preview 有可映射选区时复制选区优化指令，否则回退到当前 active issue 的命中优化指令。

Task 07 latest supplement addendum（2026-07-03）：外部 LLM 片段回填链路补齐，当前 source/preview 有可映射选区时可用 Ctrl/Cmd+Alt+V 从剪贴板替换选区，复用原 inline 菜单剪贴板替换与 sidecar diff/撤销路径。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 支持 Ctrl/Cmd+Alt+T 在 source/preview 模式间切换，复用原 `updateMode()` 路径并在分段按钮 title 中暴露快捷键。

Task 07 latest supplement addendum（2026-07-03）：通用 `SegmentedControl` 会把 `option.title` 同步为按钮 `aria-label`（缺省回退 label），ReviewEditor 的 source/preview 模式按钮现在用可访问名称暴露 Ctrl/Cmd+Alt+T；浏览器 smoke 已覆盖按 accessible name 找到源码/预览按钮并用快捷键往返切换。

Task 07 latest supplement addendum（2026-07-03）：工作台左右分屏的拖拽 separator 补齐键盘调整能力，聚焦后可用 ArrowLeft/ArrowRight 微调、Shift 加速、Home/End 收放到最小/最大宽度；键盘路径复用同一持久化宽度与 clamp 规则。

Task 07 latest supplement addendum（2026-07-03）：source/preview inline 选区菜单把外部 LLM 选区优化指令提升为带文字的主入口（`复制指令` / `Copy prompt`），复用原 Ctrl/Cmd+Alt+L 与 prompt 构造路径，降低未接 LLM 阶段的关键工作流发现成本。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 批注 rail 在桌面端支持拖拽调整宽度，复用 `useResizablePanel()` 并持久化到 `reviewCommentPanelWidth`；移动端仍保持上下堆叠布局，批注数据与审稿队列不变。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 批注 rail 的 resize separator 补齐键盘调整能力，聚焦后可用 ArrowLeft/ArrowRight 微调、Shift 加速、Home/End 收放到最小/最大宽度；键盘路径复用同一持久化宽度与 clamp 规则。

Task 07 latest supplement addendum（2026-07-03）：批注审稿键盘流补齐 `Ctrl/Cmd+Alt+C`，可复制当前激活批注的原文片段、批注正文和处理状态，复用原卡片按钮的 `copyCommentContext()` 路径。

Task 07 latest supplement addendum（2026-07-03）：修改标注巡检流补齐当前 diff 上下文复制，工具条新增复制按钮，`Ctrl/Cmd+Alt+Shift+C` 可复制修改标题、来源、删除文本和插入文本，零宽字符会转成可读标签。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 工具条和批注 rail 的纯图标控件补齐显式 `aria-label`，覆盖 diff 巡检、复制修改上下文、批注栏开合、批注栏 resize、批注巡检和清空/收起入口。

Task 07 latest supplement addendum（2026-07-03）：source textarea selection menu 与 preview TipTap BubbleMenu 的纯图标控件补齐显式 `aria-label`，覆盖复制、剪贴板替换、块样式、inline Markdown 格式、链接、引用/列表/代码块、源码定位和清除格式入口。

Task 07 latest supplement addendum（2026-07-03）：source 模式下点击/移动光标到修改标注范围会激活对应 diff，已与 preview 点击 diff 的行为对齐；激活后现有复制当前修改上下文、清除当前修改标注和 diff 巡检入口可直接使用。

Task 07 latest supplement addendum（2026-07-03）：批注 rail 卡片操作补齐显式 `aria-label`/`title`，覆盖定位批注、复制批注上下文、完成/重开、编辑和删除批注；删除批注使用独立 `review.deleteCommentTitle` 文案，避免多条批注时出现泛化操作名。

Task 07 latest supplement addendum（2026-07-03）：批注 rail 卡片操作的可访问名称继续带上被批注原文片段，覆盖定位、复制上下文、完成/重开、编辑、删除，以及编辑表单保存/取消；普通空格保持自然显示，不可见字符会转成可读标签。浏览器 smoke 已覆盖 `其实` 当前命中批注保存后，rail 操作与编辑表单按钮均包含对应 quote 上下文。

Task 07 latest supplement addendum（2026-07-03）：批注编辑保存新增反馈与撤销：`TextPanel.updateComment()` 会记录旧正文，保存后显示“已更新批注”，撤销时若批注仍存在则恢复旧正文。`bun run typecheck`、`bun run build` 通过；浏览器 edit-undo smoke 已尝试但受 rail 编辑表单自动化时序影响，未声明通过，详见 Task 07 walkthrough。

Task 07 latest supplement addendum（2026-07-03）：右侧 IssueCard 的规则详情、定位命中和应用替换/删除按钮补齐带上下文的 `aria-label`/`title`，名称包含规则标题或命中文本，避免重复列表中只出现泛化的“详情/定位/替换”操作。

Task 07 latest supplement addendum（2026-07-03）：TextPanel 上一处/下一处命中、ReviewEditor 清除全部修改标注、当前命中批注和当前替换按钮补齐显式 `aria-label`，复用现有快捷键/上下文 title，导航命中到应用替换的工具条路径更稳定。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor inline Markdown 清除格式补齐双反引号 code span，`foo\`bar` 这类含反引号文本经过 inline code 格式化后可再用清除格式恢复，`code` 与 `clear formatting` 操作闭环。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor inline Markdown toggle 更贴近 TipTap：选中已格式化 span 的内部文本后再次点击同一格式按钮会取消外层格式，覆盖 bold / italic / strike / 单反引号 code / 双反引号 code，并避免把 `**...**` 或双反引号误判成单字符 wrapper。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 链接编辑补齐 label 反转义语义；更新已有链接 href 时不会双重转义 `[a\\]b]` 这类 label，移除链接时会还原为用户看到的 `a]b` 文本。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor inline 链接创建会根据选中文本预填 href；已有 Markdown 链接仍优先使用原 href，普通 `http(s)` / `mailto:` / `tel:` 选区直接带入，`www.` 选区补 `https://`，邮箱选区补 `mailto:`。source textarea menu 与 preview BubbleMenu 复用同一选择状态 helper，并补充纯函数回归测试，链接创建路径更接近 TipTap 编辑器体验。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 链接预填契约继续收紧；已有 Markdown 链接 destination 即使为空也会优先保留，不会因为 label 看起来像 URL 就重新推断 href。已补 full-link / label-only 空 destination 纯函数回归测试和 source 模式浏览器 smoke。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor inline 菜单的“移除链接”改为专用 `remove-link` 命令，不再复用广义 `clear-formatting`；在标题、列表、引用等块结构内 unlink 时只移除 Markdown link wrapper，保留外层块格式。source/preview 菜单共用该命令，source 模式浏览器 smoke 已覆盖 `# [标题](url)` -> `# 标题`。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor Markdown formatting command 类型收口到 `web/app/utils/markdown-format-command.ts`，source textarea menu、preview BubbleMenu 和 editor handler 不再各自维护命令 union；新增 preview BubbleMenu unlink smoke，覆盖 `# [标题](url)` 预览选区移除链接后回到源码仍为 `# 标题`。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 链接 href 预填会清理选中 URL/email/`www.` 文本尾部的句末标点与不匹配右括号，避免用户框选 `https://example.com/path。` 时把 `。` 写进 href；平衡括号 URL 仍保留。已补纯函数回归测试和 source 模式浏览器 smoke。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 新建 Markdown link 时复用同一 URL/email/`www.` 候选清理逻辑，URL-like 选区尾部句末标点会留在链接 label 外，例如 `https://example.com/path。` 会生成 `[https://example.com/path](https://example.com/path)。`；普通短语链接不受影响。source 模式应用链接 smoke 已覆盖。

Task 07 latest supplement addendum（2026-07-03）：修复模式第一层基础落地：工作台进入时保存原文基线，左侧正文作为修复稿继续编辑；TextPanel 顶部显示原文字数、修复稿净变化和回到原文入口，重置支持撤销。Web 单条静态替换可在用户确认下应用 `candidate` replace 规则，但共享 helper 默认仍只允许 auto，CLI `fix` 自动修复边界不变。source 模式会叠加“修复稿相对原文”的标注式 diff；删除候选和删除 diff 改为直接在正文基线画红色删除线，不再统一使用右上角标。已用 `测试！！！ / 测\u200b试 / 他说……...` 链路浏览器验证提交、机械修复、修订标注、回到原文与删除线视觉。

Task 07 latest supplement addendum（2026-07-03）：修复模式 source diff 叠加规则收紧：具体的静态/LLM sidecar diff 优先显示并保留在 diff 巡检队列，修复稿相对原文的 baseline diff 只补没有被具体 diff 覆盖的手动编辑区域，避免机械修复后同一处同时出现规则 diff 与 baseline diff 的重复删除标注；浏览器 smoke 已覆盖三处机械修复不重复标注、回到原文后手动追加文本仍显示 baseline 标注。

Task 07 latest supplement addendum（2026-07-03）：source 删除候选的草稿纸删除线语义改为结构化字段传递：`ReviewEditor` 给 replacement range 传 `isDelete`，`HighlightedTextarea` 不再通过比较本地化文案 `review.delete` 来判断删除样式，避免后续文案/i18n 调整破坏删除线显示；浏览器 smoke 已覆盖零宽删除候选直接显示删除线且不出现 `-> 删除` 角标。

Task 07 latest supplement addendum（2026-07-03）：preview 模式删除候选视觉与 source 对齐：TipTap preview decoration 为删除候选增加 `llmlint-issue-delete-replacement`，直接在正文上画红色删除线并取消 `-> 删除` 箭头；非删除替换仍保留 `-> replacement` 提示。浏览器 smoke 已覆盖 `测试！！！` 替换候选仍显示箭头、`测\u200b试` 删除候选在 source/preview 都显示删除线。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 工具条的静态修复统计从单一“可替换”总数拆成 `替换 N / 删除 M`，让修复模式更像草稿纸改文时的动作清单；浏览器 smoke 已覆盖一处连续标点替换 + 一处零宽删除时显示 `替换 1 / 删除 1`，且删除候选仍保持直接删除线。

Task 07 latest supplement addendum（2026-07-03）：右侧 IssueCard 的单条应用按钮区分 auto 与 candidate：自动修复仍显示绿色 `替换` / `删除`，候选修复显示 amber `候选替换` / `候选删除`，并同步到 aria-label/title；浏览器 smoke 已覆盖默认 Agent 视图下 `其实` 显示 `候选删除`、展开全部后连续标点 auto 仍显示普通 `替换`，点击候选删除可写入修复稿。

Task 07 latest supplement addendum（2026-07-03）：source textarea menu、preview BubbleMenu 和 active-hit toolbar 的候选静态修复入口也与右侧列表对齐，显示 amber `候选替换` / `候选删除`；应用删除后的 source diff 标注继续保持不改变 textarea 布局的覆盖层，但去掉徽标背景、圆角和小字号，改为贴正文基线的红色删除线。浏览器 smoke 已覆盖 source/preview 删除候选无 `-> 删除` 箭头，以及点击 `候选删除` 后 diff 标注为透明背景、0 圆角、正文尺寸删除线。

Task 07 latest supplement addendum（2026-07-03）：source textarea selection menu 的禁用控件视觉与 preview BubbleMenu 对齐；普通段落选区下不可用的列表缩进/减少缩进按钮会显示明确禁用态（低透明度、默认光标、无 hover 高亮），并保留 `先选择列表项` 的 aria/title 解释。浏览器 smoke 已覆盖 source 菜单打开后的 disabled 样式与可访问名称。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 的命中级别、候选/人工状态、替换 title 和替换按钮文案收口到 `web/app/utils/review-issue-ui.ts`，source textarea menu、preview BubbleMenu 和 active-hit toolbar 共用同一套文案组合，避免候选删除/应用候选删除再次漂移。已补纯函数回归测试，并用浏览器 smoke 覆盖右侧命中激活 toolbar、source inline menu、preview BubbleMenu 三条候选删除路径。

Task 07 latest supplement addendum（2026-07-03）：source textarea menu 与 preview BubbleMenu 的批注/链接表单焦点管理从全局 `document.querySelector` 收口为组件本地 template refs；`data-review-*` 标记保留给测试和宿主键盘保护。浏览器 smoke 已覆盖 source 批注自动聚焦、source 链接 href 全选、preview 链接 href 全选三条路径。

Task 07 latest supplement addendum（2026-07-03）：source textarea menu 与 preview BubbleMenu 的批注/链接表单按钮补齐完整操作合同：保存/取消/应用链接/移除链接都有显式 `aria-label`/`title`，并补齐 comment/link cancel 稳定 `data-*` 钩子。浏览器 smoke 已覆盖 source 批注、source 链接和 preview 批注表单按钮。

Task 07 latest supplement addendum（2026-07-03）：当前命中批注表单也对齐 inline 表单按钮合同：取消按钮新增稳定 `data-review-active-issue-comment-cancel`，取消/保存按钮补齐 `aria-label`/`title`。浏览器 smoke 已覆盖右侧命中 -> Ctrl/Cmd+Alt+M -> 当前命中批注表单按钮 -> 取消关闭。

Task 07 latest supplement addendum（2026-07-03）：source textarea menu 的 toolbar 和块样式菜单补齐 `@mousedown.prevent`，与 preview BubbleMenu 保持一致；点击格式化/块样式按钮前不会让按钮抢走 textarea 焦点或打散 source 选区，批注/链接表单区域仍保持正常聚焦。浏览器 smoke 已覆盖 toolbar mousedown 后 source textarea 仍 active 且 selection 不变，以及链接表单聚焦不受影响。

Task 07 latest supplement addendum（2026-07-03）：修复入口发现性与规则元数据收紧：右侧 IssueCard 的可修复命中现在常驻显示 `能修复` / `候选修复` 标签和应用按钮，不再依赖 hover 才露出；规则 loader 会读取规则 JSON 中的 `review` / `fixability` 字段，并把最终 `fixability` 约束到真实能力，只有 `regex` + `replace` 可保持 `auto` / `candidate`，`suggest` / `llm` 规则会回落为 `manual`，避免 UI 把不可替换命中伪装成可修复。`cd web && bun run typecheck` 与聚焦单测通过；完整 llmlint 测试文件在 Windows 5s CLI 子进程超时下仍不稳定，本轮未声明全量通过；`web build` client/server 完成后 Nitro server packaging 长时间无输出，已停止该 build 进程树。

Task 07 latest supplement addendum（2026-07-14）：修复 source 模式删除 diff 与当前正文重叠导致文字叠飞。旧方案为保持 textarea 精确布局，把整段删除文本绝对定位到正文基线；当删除文本长于插入文本时，两层文字必然互相覆盖。source 背板现改为在删除锚点上方显示紧凑的红色 `-N` 字符数徽标，不再绘制整段旧文；完整删除内容仍保留在 preview diff 与当前修改上下文中。实际方案与旧计划的出入：保留“不改变 textarea 布局”的硬约束，但放弃 source 基线上的全文删除线展示，优先保证正文可读性与定位稳定。`web:typecheck` 通过；本地浏览器在用户截图同尺寸 `1534×465` 与窄屏 `390×844` 验证无正文叠字或新增横向溢出。

Task 05 latest supplement addendum（2026-07-14）：Web 完成二次元漫画编辑部 / 稿件扫描终端视觉改造。全局主题、Header、首页扫描台、历史分镜卡和工作台面板统一为青绿/珊瑚红/金色/炭黑/纸白印刷体系；保留工具第一屏和全部检测行为。移动端补充正文/报告高度约束，修复 390px 工作台正文被 flex 压到 1px 的问题。`web:typecheck` 通过；1280x720 light/dark 与 390x844 首页/工作台检查无横向溢出。原计划的原创角色位图因当前无可用内置图像生成工具未落地，本轮改用代码原生漫画视觉，未要求或读取用户 API Key。

Task 07 latest supplement addendum（2026-07-14）：审稿工作台的规则卡片、编辑面板和分隔器对齐漫画主题，分别加入三色印刷顶线、主题表面和网点纹理；只改视觉，不改命中定位、替换、批注或审稿状态。窄屏正文/报告分区修复后在 390x844 下分别保有 334px/425px 可操作高度。

Task 05 latest supplement addendum（2026-07-14）：前端代码整理完成。严格 `vue-tsc` 未发现未使用 TS，因此没有高风险拆分 `ReviewEditor`；首页桌面/移动历史卡片从两套重复模板收口为一套响应式模板，`HomeInputPanel` 从 641 行降到 529 行，并补齐历史入口、评分和展开按钮的原生语义。删除 `AppHeader` 未读取的 `registry` prop、IssueCard 死 opacity CSS 与 5 个无用途标记类。`web:typecheck` 通过；桌面历史收起/展开、评分、进入工作台及 390x844 无横向越界浏览器链路通过。

Task 05/06 latest supplement addendum（2026-07-14）：Web 全站空态密度优化完成。报告页增加 AUC/PAIR/RULES 与规则信号报告预览，数据集页增加 corpus tree 与 reference/render 配对预览，首页无历史状态增加真实 registry 状态台（303 regex / 8 LLM）；登录/注册共用稿件审阅场景外壳，保留原认证逻辑。实际范围没有重做已足够密集的审稿工作台，而是集中填补报告、数据集、认证页和首页无历史状态。`web:typecheck` 通过；1280x720 深浅主题及 390x844 报告、数据集、登录/注册检查无横向溢出。为保护用户本地历史，没有清空现有记录去截图无历史状态台。

Task 08 latest supplement addendum（2026-07-14）：评测可信度前置守门完成。render prompt 版本改为每个 sample 的必填审计字段；generator 新生成时写入版本，断点复用旧文件前强校验，score 对缺版本或跨版本直接退出且不产报告，成功报告记录唯一 `renderPromptVersion`。holdout 门槛、切分、规则 train 拟合与 AUC 只使用存在有效 `pairRef → reference.file` 映射的题组，reference-only/悬空配对不再虚增题组数。聚焦测试 12/12、根 typecheck、fixture AUC 1.000 通过；当前 corpus 28 个旧 render 缺样本级版本，已确认被守门拒绝。Task 08 M3/M4 完成前冻结新基线，当前 `0.530` 仅是 reference 已扩量但 render 未补齐的中间语料状态，不能作为规则质量结论。

## Known Follow-ups

- **Agent 历史与 Revision workflow（TODO，2026-07-19）**：后续评估接入 nb-history 承载 Session 历史浏览/分支；Revision 提交、进入下一版本、Session 切换、检测触发/重试必须统一设计 approval、幂等、长任务状态和失败恢复，本轮没有加入临时写工具。
- **Task 11 编辑器数据模型（Implemented，2026-07-07，待 playwright 验收）**：编辑器从四套并存坐标系收敛到**单一坐标权威**——一切锚定不可变原文坐标，草稿坐标由 piece-table 投影现算。批注改源锚定 `ReviewAnnotation`（`sourceFrom/sourceTo` + 投影 `stale`「原句已改」提示），`transformReviewComments/Diffs*` 命令式搬运与 `repairDiffs` prop 等死代码全删，undo 只回滚 plan 快照；sidecar 批注存储升 v2（按**原文** key，v1 废弃）。建议与已应用编辑显式分层：**未应用替换不再常驻画进正文**（绿浮标错位与「未修改却有删除线」两 bug 的根因），替换预览按需收敛到工具条/选区菜单/IssueCard，preview 徽章与删除线仅 active 命中显示。86 测试 + 双 typecheck 绿；预览精确 offset 映射（替换 indexOf 模糊匹配）拍板延后为独立任务。详见 [docs/tasks/11-editor-data-model/README.md](docs/tasks/11-editor-data-model/README.md)。

- **Task 12 统一数据模型（Designed，2026-07-06）**：评测语料 + web 采集收进同一概念模型（参与者×文本×断言；reference+render = LLM 扮演参与者，量大信度低）。设计定稿：`origin` 三变体（curated/generated/uploaded，删 seeded_gold/goldProvenance）、MachineRecord 拆 MachineScan/MachineDetect（含热力图 chunksJson 槽位）、PairJudgment/LlmJudgment 规范先行建表后置、**D1 改写为 lift 闸门**（只吃 origin∈{curated,generated}）。CONTEXT §2.5/D1 与 METHODOLOGY §0/§7 已同步。**web schema 增量迁移已由 [Task 13](docs/tasks/13-web-five-step-flow/README.md) W1 执行**（2026-07-07）。详见 [docs/tasks/12-unified-data-model/README.md](docs/tasks/12-unified-data-model/README.md)。

- **Task 08 Eval Pipeline Hardening（Implemented，2026-07-03）**：环 ① 全链路硬化 + 小验证轮已跑通。M1 calibre 批转 mobi + catalog 状态层（`neuro-book/datasets/aigc-detection`，manifest 为书目真相源）+ 3 新题组（武侠/宫斗/无限流）；M2 generator 硬化（commander、`eval.config.json`+example 双文件、prompt 版本化注册表守 I8、`claude -p`/`codex exec` CLI transport 走 stdin/合并契约、per-provider 限流、token 预算预估/实报/自校准）；M3 可换外部检测器（HF yuchuantian，句界分块避截断、长度加权 mean、sidecar 内容 hash 缓存、`report.externalDetector` 对照节，复用 rocAuc 同口径）；M4 5 题组/65 render：**llmlint AUC 0.681**（较旧 2 组 0.833 降＝判别力 genre-dependent 实证）、**holdout 首解锁** train0.616/test0.778、**外部检测器 AUC 0.941 ≫ llmlint**（证检测器是强 oracle 地基、gap=漏网新规则矿）。⚠ CLI transport 上游 anyrouter 不可达（claude 挂起/codex Reconnecting）未端到端验证，已降级快退。详见 [docs/tasks/08-eval-pipeline-hardening/README.md](docs/tasks/08-eval-pipeline-hardening/README.md)。
- **Eval M3**：更多题材/题组/模型 + 文风预设档 + holdout 切分；补稀疏规则 prevalence 口径、真 1:1 同 brief 配对；稳后把「规则体检表」正式交 Task 02 驱动规则修复。M4 的 repair 一轮已建（[Task 14](docs/tasks/14-line-a-repair-loop/README.md)，2026-07-07），余 realism 难度档 + critic；之后 M5（LLM 规则判别 + 产品成绩单 + 显形回归集）。
- **规则质量**：第二轮已落地 `creative-writing@1`：排除 noise/anti，稳定抑制重叠规则，保留 canonical rule 与原因；Task 23 后续规则整理已把稳定 overlap 和素材通配符转换遗留（含占位比喻壳）同步为默认 disabled，并把 R18/人体/解剖/颜色/一声/商业黑话/regex advanced 等题材词表、宽泛低信号 regex、裸词级规则、普通开场连接词、泛否定转折、裸嘴角弧度、宏大时代开场、弱新颖性拔高、普通动作音效尾句和过时 modifier strong override 下沉 human，`few-degree` 撤回 Agent 例外并排除“几分钟/几分之一”半截误报，裸“近乎”从默认 Agent 规则中移除，`unquestionable-claim`、`trailing-sensory-clause`、否定连排与标点后“一股”量词 overlap 已继续收窄，但不删除资产。后续继续用更多题材 holdout 校准，避免把单轮 verdict 物理写死为全局删规则。

## 2026-07-11 第二轮规则精简

- 默认规则 materialize 结果（Task 23 规则整理后）：360 total / 287 active；266 regex / 8 density / 5 handler / 8 LLM；review = agent 96 / human 188 / none 3；regex fixability = `auto=3 / candidate=0 / manual=263`。用户配置仍可把指定 regex replace 提升为 candidate。
- Web registry 烘焙版本化 `creative-writing@1` profile。报告有效时排除 noise/anti；报告缺失时保留全量，但稳定 overlap 抑制仍生效。规则页保留完整超集并解释 profile 排除原因。
- `Report.overlap` 已纳入正式报告：16,962 raw hits / 11,388 unique spans / 32.9% 原始重复率；score 默认 holdout=0.4。
- 指定 NeuroBook `index2.md`：全量静态命中 115、机械修复 0、LLM 创作候选 17、候选重复 span 0。程度副词、量词、句尾比喻和二元转折家族不再重复进入清单。
- Profile holdout 验收：test AUC 0.990；人类 Agent 误杀 1.12/千字；AI Agent 命中 5.40/千字，是人类侧 4.81 倍；test duplicate rate 11.1%。
- 与首轮方案的出入：没有继续把 strong 语义规则提升为 candidate；判别力只决定是否进入创作 profile，机械权限仍由 `fixability` 独立决定。

## 2026-07-11 Web 配置式鉴权

- 新增 `NUXT_AUTH_ENABLED`：开发环境默认关闭，生产构建默认开启，`.env` 可覆盖。
- 登录关闭时，统一身份解析层返回稳定的 `__llmlint_local_development__` 普通用户，不依赖 Cookie；删除原先按静态路径名单创建随机匿名 session 的中间件。
- 配置式鉴权关闭时，workspace、reveal/machine、Agent session、detector run 等动态接口统一使用稳定本地开发用户，不依赖 Cookie。
- 前端随配置隐藏账号菜单；登录开启时 `/contribute` 路由守卫要求 session，关闭时直接进入工作台。login/register 在关闭模式返回 409。
- **语料合规**：`evals/corpus/` 当前随私有仓保存；**转公开前必须先移除或 gitignore `evals/corpus/`，只留 fixture**。
- **发布**：commit / push 到 `github.com/notnotype/llmlint`、tag、以及是否上 npm 由用户决定，本仓文档不代为执行。
- **Web 后续**：采集站部署宿主与数据库备份策略；注册限流/邀请码；~~LLM classification~~ ✅（Task 13 W6，mimo 异步补空）；~~外部 AIGC 检测器服务端通道与应用验收环~~ ✅（Task 13 W3，D5 检测概率腿已接、热力图数据已收 UI 后置）；~~curated/generated 语料导入~~ ✅（Task 13 W5，取代原 seeded-gold 指派评分流）；consent 删除/保留策略；众包公开池 + PairJudgment 打标小游戏 + LlmJudgment 通道口径（待拍板）；可选行内命中 hover 提示、分享链接/设置导入导出、完整 config 编辑器。~~`prisma migrate dev/db push` 报空 schema engine 错~~已解决（2026-07-01 复核）：根因是没设 `DATABASE_URL`，设 `file:./data.db` 后标准 migrate 干净通过；端到端 API 闭环（注册→上传→盲评→揭示→标注→导出）已用真 dev server 验证，见 `web/README.md` 与 `web/.env.example`。

# Skill 闭环与服务接入（初始化 / 检测 / 修复 / 疑难片段 / 学习）

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [CONTEXT.md](../../../CONTEXT.md)：体系四环定位（本任务把 skill 端接进环②③）
- [PROJECT-STATUS.md](../../../PROJECT-STATUS.md)
- [skill/SKILL.md](../../../skill/SKILL.md)：现有 skill 工作流（本任务改写为五步流程）
- `evals/detector/hf-client.ts`：神经检测客户端实现（`detect` 命令移植来源）
- `web/server/utils/detect.ts`：服务端同算法通道（后续登录用户切换的目标形态）
- nb-workshop `reference/passport/api-v1.md`：NeuroBook Passport 设备码规范（分片 3 消费）
- 参考项目：`oh-story-claudecode/skills/story-deslop`（MIT，规则可吸收）、story-oracle 提示词提取快照（无 LICENSE，只提炼原则不搬原文）

## User Request / Topic

- 策略转变：暂缓 web 前端，优先把 skill 做好。
- skill 五步流程：① 初始化（登录 + 数据共享同意）→ ② 检测（静态规则 + AIGC 热力图 → 报告）→ ③ 修复↔检测循环（通常一轮）→ ④ 疑难片段交用户判定 → ⑤ 学习（本地规则优化 + 数据上传）。
- 关键创新：规则不再全由维护者负责，使用者也能提供规则和评价。
- 两种登录形态：独立 Harness 走 Passport 设备码；NeuroBook 内自动登录。
- 吸收 story-oracle / story-deslop 的提示词与规则（另见本目录后续分析记录）。

## Goal

分片 1 的目标是让 skill 端形成「初始化 → 检测 → 修复 → 疑难片段 → 本地学习建议」本地闭环，verified by：`status` / `config set` / `detect` 可独立运行、SKILL.md 五步流程改写完成、疑难片段台账和本地 `llmlint.config.ts` 覆盖建议出口写清。约束：不破坏现有 `check`/`fix`/`show-llm-rules` 合同与三层配置覆盖机制；吸收新规则走正常 ruleset 资产路径。`login`、contributions 上传和 web ingest 端到端打通留给分片 2/3。

## Current State

- `skill/` 已是 v2.0.0 自包含包：`check`（regex 候选定位 + markdown 遮罩）/ `fix`（仅 auto 桶）/ `show-llm-rules`；340 规则 / 311 active；`llmlint.config.ts` 三层覆盖（rule id > namespace > ruleset）。
- 神经检测：`evals/detector/hf-client.ts`（客户端直连 HF yuchuantian gradio、句界分块、P(AI) 归一、长度加权 mean+max、content-hash sidecar 缓存）；web 端 `detect.ts` 同算法 + 代理 + `chunksJson` 热力图落库。
- web 鉴权：nuxt-auth-utils 自有账号，未接 Passport。
- skill 无用户级状态层、无神经检测命令、无上传通道。

## Decisions / Discussion

已拍板（勿重议）：

1. **状态分层**：分发物（`skill/`，无状态）/ 项目配置（`llmlint.config.ts`，规则 + 可覆盖共享档位）/ 用户状态（`~/.llmlint/auth.json` + `settings.json`：凭据、共享同意、detector proxy、初始化标记）。**不用 SKILL.md frontmatter 存状态**（升级覆盖丢失、进 git 泄漏）；agent 判断初始化改跑 `llmlint status --format json`。
2. **AIGC 检测暂不要求登录**：`detect` 命令客户端直连 HF（移植 hf-client），传输层抽 `DetectorTransport` 接口，将来登录用户切服务端通道只换实现。
3. **共享粒度**：四档 `sharing.tier`（`off` / `stats`=命中统计+检测分数 / `fragments`=+疑难片段 span 文本+判定+diff / `full`=+全文修复谱系）+ 双开关 `sharing.mode`（`auto`/`ask`）与 `sharing.anonymous`。**默认 `fragments` + `ask`**。config schema 预留 `sharing.items` 逐项逃生舱。
4. **疑难片段上下文窗口大小由 agent 视情况决定**（影响 fragments 档上传内容）。
5. **实施顺序**：skill 端 + 服务最小 API 同步（分片见下）。
6. 数据项枚举（共享档位的映射基础）：a 规则命中统计 / b 检测分数 / c 疑难片段 span 文本 / d 用户判定 / e 修复前后 span diff / f 修复前全文 / g 全文修复谱系。
7. 疑难片段四象限：规则密集×热力红=确认疑难交用户；规则静默×热力红=漏网新规则矿；规则密集×热力绿=规则误报候选；双绿=不打扰。
8. 学习两条出口：本地=判定翻译成 `llmlint.config.ts` 覆盖建议（agent 出 diff、用户批准，复用三层覆盖，不改内置规则文件）；远端=contributions 上传（档位门控）。
9. 许可边界：oh-story-claudecode 为 MIT，规则可吸收（带 attribution）；story-oracle 无 LICENSE，只提炼原则重新表述。

## Verification / Test

- B 线提交前验证：`bun run test:vitest` 267 passed；`bunx tsc --noEmit --pretty false` 通过；`cd web && bun run typecheck` 通过（Volar 既有插件警告）；`status/config` 临时 `LLMLINT_HOME` 冒烟通过；HF detect 真跑成功，二次 `cached:true`，`--no-cache` 返回 `cached:false`。
- A 线聚焦验证：`bunx vitest run tests\calibration.test.ts` 3 passed；`bunx vitest run tests\calibration.test.ts tests\scan-context.test.ts tests\density.test.ts tests\handler-rules.test.ts` 35 passed。
- A 线最终验证记录：接管前 `bun run test:vitest` 270 passed。接管后复跑 A/B 交叉窄测 35 passed；`bunx tsc --noEmit --pretty false` 通过；`cd web && bun run typecheck` 通过（Volar 既有插件警告：`vue-router/volar/sfc-route-blocks` 加载失败）。后续审查修复长对白误报后复测 Task 23 窄测 50 passed、完整 `bun run test:vitest` 271 passed、HF detect 小文本真跑成功且二次 `cached:true`；web registry 当前为 310 regex / 8 llm / 330/359 active。

## Implementation Walkthrough

分片规划：

1. **分片 1（skill 本地全链路）**：`status` / `config set`、`~/.llmlint/` 状态层、`detect`（hf-client 移植 + proxy + 缓存）、SKILL.md 五步流程改写、四象限报告 + 会话台账（`.agent/llmlint-session.json`）、修复指导融合参考项目原则。
2. **分片 2（学习闭环）**：本地 config 覆盖建议流、contributions 上传 CLI、web `POST /api/v1/contributions`（匿名可写，IP 限流 + payload 上限；落 Task 12 统一数据模型，可能新增 ContributionSession 表挂来源与档位）。
3. **分片 3（身份）**：`login`/`logout` 设备码流（Passport RFC 8628 子集）、llmlint web 校验 Passport token、具名上传、NeuroBook 环境变量注入凭据（解析顺序：env > `auth.json`）；后续可选把神经检测迁服务端通道。

### 分片 1 进展（2026-07-24）

规则模型 v3（设计见 `rule-model-v3-design.md` v3.1）**阶段 1–4 已实施且全绿**（root tsc + web vue-tsc + vitest 248 例）：

- 阶段 1 ScanContext：`skill/src/scan-context.ts` 三层等长视图（narrative/dialogue 引号段等长 `。` 占位，换行保留）、行内引号配对（未闭合/跨行/遮罩区不配对）、结构行标记、`scope` 字段 + position 窗口、loader 不变量 auto/candidate⇒全域（`scoped-rule-not-auto-fixable`）。测试 `tests/scan-context.test.ts`。
- 阶段 2 ignoreTerms：config 归一 + 三种 detector 统一重叠丢弃 + fix 并入遮罩段。
- 阶段 3 density：`skill/src/density.ts` 门槛 AND（minHits/perKilo/coreMinHits/minBuckets/minChars）、doc/paragraph 粒度、结构行与遮罩不进分子分母；`DensityIssue` 进报告与退出码；未知 `detector.type` 由 throw 改 skip+warning（`unknown-detector-type`）。测试 `tests/density.test.ts`。
- 阶段 4 handler：`HandlerRuleRecord` 改 `{type:"builtin",name}`（module 形态废弃拒载）；`skill/src/handler-rules/index.ts` 注册表 + 4 handler 移植（not-is-comparison 状态机/period-stutter/overcompressed-prose/low-connective-density，story-deslop MIT，阈值与排除矩阵照搬）；`Issue.rule` 放宽为 regex∪handler 联合 + `detail` 字段；web 消费面（RuleGroup/RuleDetailDialog/rule-category 等）已适配。
- 与计划出入：① period-stutter 等句长统计 handler 未用占位视图而用 stripQuoted 语义（占位 `。` 会把混合行错切成两句，见 handler-rules 内注释）；② `Issue` 增加了计划外的 `detail?` 字段承载 handler 动态计数；③ handler 规则要求 `action:{type:"suggest"}` 必填（reporter 复用）；④ 阶段 4 的校准例句测试矩阵移入 A 线待办。

### 分片 1 拆分与完成情况（2026-07-24）

- **B 线（完成，commit `0d8b7f3 feat(skill): complete rule model v3 local loop`）**：handler 管线测试、用户状态层、`status`/`config`、`detect`、代理分流、缓存、用户状态/检测测试已落地。实际出入：`node-fetch-native` 同时加入根开发包和 `skill/` 包；detect 网络层不做单测，按真实 CLI 冒烟验证。
- **A 线（完成）**：按 `PLAN-A-rules-and-prompts.md` 导入 story-deslop 校准规则（manifest MIT attribution、规则 `source.importedFrom` 与校准 note）、补 namespaces 策略/中文 alias、新增 `tests/calibration.test.ts`、改写 `skill/SKILL.md` 五步流程、新增 `repair-guide.md` 并同步 `cli-usage.md` / `workflow.md` / `patterns.md` / `CONTEXT.md` / `PROJECT-STATUS.md`。

### A 线规则导入详情

- blocking：`cliche.voice-contrast`、`contrast.binary` 的 `not-is-comparison` handler 与 `reverse-not-is`、`contrast.negative-listing` 两种否定排比、`ending.trailer` 文末 600 字窗口、`mechanical.stage-leak` tier1。
- advisory / human：套词密度、比喻密度、解释链、抽象总结复读、微动作复读、动作清单、公文腔公告、碎句号、过度精炼、低连接密度、长段落、工程词 tier2。
- 与计划出入：① `notice-formality` 受当前 density 执行器限制，按 `dialogue + paragraph` 近似实现，未复刻原脚本“至少 4 行公告”门槛；② `quote-emphasis` 与复读/截断退化仍按设计留后续批次；③ 破折号差集核对后未新增规则，沿用现有 `punctuation.dash` 家族，避免重复。

## TODO / Follow-ups

- [x] story-deslop 规则吸收分析与导入方案（`rules-absorption-analysis.md` + `rule-model-v3-design.md`）
- [x] 分片 1 规则模型 v3 阶段 1–4（ScanContext/ignoreTerms/density/handler）
- [x] 分片 1 A 线：校准规则导入 + SKILL.md（`PLAN-A-rules-and-prompts.md`）
- [x] 分片 1 B 线：用户状态层 + status/config + detect（`PLAN-B-coding-handoff.md`，交外部 Agent）
- [ ] 分片 2 实施
- [ ] 分片 3 实施
- [ ] contributions 数据模型对 Task 12 统一模型的映射设计
- [ ] 后置：banned-words 逐词差集（独立任务）；quote-emphasis handler、复读/截断退化检测（后续批次）

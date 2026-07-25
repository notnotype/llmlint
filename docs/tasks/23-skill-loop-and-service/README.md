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

- `skill/` 已是 v2.0.0 自包含包：`check`（regex 候选定位 + markdown 遮罩）/ `fix`（仅 auto 桶）/ `show-llm-rules`；当前默认规则为 360 rules / 287 active；`llmlint.config.ts` 三层覆盖（rule id > namespace > ruleset）。
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
- A 线最终验证记录：接管前 `bun run test:vitest` 270 passed。接管后复跑 A/B 交叉窄测 35 passed；`bunx tsc --noEmit --pretty false` 通过；`cd web && bun run typecheck` 通过（Volar 既有插件警告：`vue-router/volar/sfc-route-blocks` 加载失败）。后续审查修复长对白误报后复测 Task 23 窄测 50 passed、完整 `bun run test:vitest` 271 passed、HF detect 小文本真跑成功且二次 `cached:true`。

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
- 与计划出入：① `notice-formality` 受当前 density 执行器限制，按 `dialogue + paragraph` 近似实现，未复刻原脚本“至少 4 行公告”门槛；② 破折号差集核对后未新增规则，沿用现有 `punctuation.dash` 家族，避免重复；③ 复读/截断退化仍留后续批次。

### 规则系统精简补充（2026-07-24）

- 默认规则整理：把 creative profile 已稳定抑制的 8 条高重叠旧规则同步为默认 `enabled:false`，不物理删除资产，用户仍可通过 rule override 显式启用。涉及程度副词、量词、句尾比喻和二元转折四个家族，默认保留对应 canonical rule，降低同一 span 重复进入问题清单的概率。
- 默认规则整理（二批）：继续默认关闭旧 `not-but-structure` / `not-x-is-y` / `negative-listing` 与两个无效星号二元规则，二元对比统一交给 story-deslop handler / 校准规则；默认关闭对白冒号替换、宽泛 simile-like、重复 body target、过宽“规律”和 `(?:了|这)一点`，并收窄 `controlling-gaze` 为必须出现“目光/眼神”。
- 默认规则整理（三批）：`on-one-hand` / `comprehensive-listing` 转 `human`；`格格不入` / `面无表情` 转 `human`；裸 `嘴角勾` 默认关闭，避免与更长嘴角弧度规则产生半截候选。
- 默认规则整理（四批）：`并没有立刻`、带主语 `并没有…而是` 转 `human`，保留给上下文判断，不作为默认 Agent 强修入口。
- 默认规则整理（五批）：继续把 active-to-active overlap 中 100% 被 canonical 覆盖的 11 条旧规则默认关闭，不物理删除资产。Agent 桶关闭 `cn.cliche.hand-whitening-detail`、`cn.cliche.mid-sentence-summary`、`cn.cliche.mouth-corner-arc-cliche`；human 桶关闭比喻壳、氛围修饰、状态修饰、夸张比附和绝对判断修饰中的重复条目，降低 `--review all` 膨胀。
- 默认规则整理（六批）：把 eval 反证或低 support 更明确的宽泛基础规则转 `human`：`filler-can-say`、`filler-lets`、`emphasis-crutch`、`rhetorical-setup`、`inflation-marvel`、`transition-summary-conclude`、`assistant-comfort-pose`；`cn.cliche.body-reaction.controlling-gaze` 已收窄后仍为 noise，也转人工上下文判断。
- 默认规则整理（七批）：继续压默认 Agent 桶里的宽泛低支撑项。`filler-worth-noting`、普通开场连接词、`transition-summary-essence`、裸 `平稳` / `尖叫` / `戏谑`、声音/眼神情绪容器、引语元叙述、`平日里` 和旧单层 `不是…而是` regex 转 `human`；`opening.cliche` 家族与 `dated-opening` 限制到叙述层文首 600 可见字，避免正文中部普通连接词误入开场规则。
- 默认规则整理（八批）：默认关闭素材通配符转换遗留：4 条嘴角规则、7 条 `metaphor.like` 占位比喻壳和 `cn.tone.tone-placeholder` 里的 `*` 被转换为字面量星号，实际只会命中带星号文本；`cn.cliche.baguwen.white-knuckles` 与 `cn.cliche.hand-color-clause` 典型同 span 重复，也默认关闭；保留资产等待重新建模。裸词级 `拆解`、`甚至是`、`因为惯性`、`外壳` 转 `human`，不再打扰默认 Agent。
- 默认 review 下沉：`vocabulary.body`、`vocabulary.r18`、`vocabulary.academic-anatomy`、`color-description`、`sound.once`、`jargon.business`、`regex.advanced` 默认转入 `human` 桶；`filler-word-actually`、`meta-announcement`、`quotable-punchline-candidate` 因 eval noise 改为 `human`。后续重扫发现 `cn.regex.advanced.few-degree` 在扩充 reference 中命中率高于 AI 文本，已撤回原 strong 例外并补 `(?![钟之])` 排除“几分钟/几分之一”半截误报；`cn.cliche.vague-transition-phrase` 移除裸“近乎”，只保留“近乎于”和“取而代之的是”。
- 默认 review 下沉补充：`cn.sentence.compound.contrastive-turn-preface` 转 `human`，因为泛“不是/并非/没有…而是/反而”在当前 dataset 中会命中合法对白、设定解释和事实辨析；默认 Agent 继续保留 story-deslop 的高信号否定对比/否定排比规则。
- 默认 review 下沉补充（二）：`cn.action-expression.mouth-corner-arc` 转 `human`，旧报告 support 不足且当前 dataset 只剩 1 个 AI 命中；默认 Agent 保留尾部分句 canonical `cn.cliche.trailing-mouth-arc-clause`。
- 默认 review 下沉补充（三）：`opening-cliche-era` 与 `inflation-novelty` 转 `human`；前者旧报告 insufficient 且当前 dataset 无命中，后者旧报告 weak、当前 dataset 仅 1 个 AI 命中，且“前所未有”等新颖性词汇在小说视角中需要上下文判断。
- 默认 review 下沉补充（四）：撤回 `cn.modifier.absolute-claim-modifier` 与 `cn.modifier.optional-mood-modifiers` 的旧 strong 规则级路由覆盖。当前正式 report 中两条均为 weak，且属于语境敏感的 modifier 桶；默认回到 `human`，避免“难以言喻的 / 低沉的 / 精准地”等宽泛修饰词继续打扰 Agent 入口。
- 默认 review 下沉补充（五）：`cn.cliche.trailing-sound-clause` 转 `human`。当前命中多是普通动作音效尾句，删除可能损失画面信息；默认 Agent 继续保留信号更明确的 `trailing-sensory-clause`，声音尾句交人工上下文判断。
- 默认 review 下沉补充（六）：当前 dataset 无命中且无旧 verdict 的普通语气/接触音效细节转 `human`：`flat-tone-shell`、`force-white-knuckle`、两条戏谑口气壳、`tightly-clenched`、杯子/杯底/骨节接触音效，以及天气/闲聊类口气比喻。理由是这些替换会删除人物语气或动作信息，适合人工读上下文判断，不作为默认 Agent 强修入口。
- 默认 review 下沉补充（七）：无校准支撑的身体/触感/声音微细节转 `human`：胸腔/胸膛、冰凉触感、面色、骨节外观、指腹/掌心触感、喉咙/舌尖/咀嚼字句、从齿间挤出、声音突兀/清晰/回荡/传来。原则是这些内容可能是具体画面或人物声音，只有在重复装饰性模板时才修。
- 默认 review 下沉补充（八）：`direct-mouth-arc`、`trailing-mouth-arc-clause`、`hand-color-clause` 和 `physiological-tears` 转 `human`。这些规则旧报告 support 不足或无 verdict，且嘴角弧度 direct/trailing 形态在普通输入上会同 span 重叠；保留资产给人工判断，不再默认要求 Agent 删除身体反应细节。
- overlap 收窄补充：`cn.cliche.baguwen.unquestionable-claim` 排除后接“的/地”，避免和 `cn.modifier.absolute-claim-modifier` 对同一修饰 span 重复；`cn.cliche.trailing-sensory-clause` 限制到叙述层，避免对白/系统面板里的尾句误报；`story-deslop.negation-parade.repeated-none` 排除后接“只有/只是/只会”的同 span 场景，交给 `story-deslop.negation-parade.only-turn`，并排除后接“然而/但/却”的真实转折。
- overlap 收窄补充（二）：`cn.cliche.baguwen.vague-amount-noun` 排除标点后的“一股”，该位置交给 strong canonical `cn.modifier.measure.subject-measure-word`；保留句中“一股”和“那股”，避免量词规则对同一 span 双报。
- overlap 收窄补充（三）：`cn.modifier.measure.specific-measure-word` 移除“股”分支，避免与 `vague-amount-noun` 继续重复；`cn.modifier.heavy-degree-shell` 只保留裸“沉甸甸”，带“的/地”的场景交给 `cn.modifier.sensory-atmosphere-modifier`。
- overlap 收窄补充（四）：`cn.modifier.measure.physiological-label` 只保留“生理眼泪/生理快感”的前缀命中；`cn.vocabulary.academic-anatomy.physiological-academic-label` 排除“生理性眼泪/快感”，只保留“生理性的/生理层面/生理本能”这类分析腔标签。
- overlap 收窄补充（五）：基础 `adverb-intensifier` 移除“极其/本质上”，交给更具体的 `cn.modifier.stacked-degree-adverbs` / `transition-summary-essence`；`cn.modifier.sensory-atmosphere-modifier` 移除“戏谑的/地”，交给 `cn.action-expression.teasing-modifier`；`cn.sentence.compound.single-negative-contrast` 排除“并不是…而是”，交给 `contrastive-turn-preface`。当前 dataset 复扫 active 同 span overlap 为 0。
- story-deslop 继续吸收：新增 `story-deslop.quote-emphasis` handler 规则，统计叙述层 1-4 字短词引号强调，全文 ≥3 处只报一条 human advisory；极短对白、系统面板、纯对白行和低于阈值的零散强调豁免。
- 闭环遗漏修复：web registry 现在预烘 active density/handler 规则，engineVersion hash 覆盖 regex+density+handler；web 本地扫描、服务端 MachineScan 与 Agent `RevisionTextWorkspace.lint_check` 均消费 regex+handler，Agent 报告额外带 density 指纹段。story-deslop high 校准 blocking 规则即使未入 eval verdict，也在 Agent 修复门中按必修强判别处理。
- 当前默认 materialize：360 total / 287 active；266 regex / 8 density / 5 handler / 8 LLM；review = agent 64 / human 220 / none 3；regex fixability = auto 3 / candidate 0 / manual 263。临时内存复算当前语料：active 同 span overlap = 0、overlap duplicate rate = 0；默认 Agent 桶 reference 侧仍只剩 `vague-amount-noun` 2 处和 `repeated-de-pairs` 1 处少量强判别权衡（未改写 `evals/report/report.json`）。
- 拿不准的规则族和许可边界集中记录在 `rule-curation-open-questions.md`，等待用户一次性拍板。

## TODO / Follow-ups

- [x] story-deslop 规则吸收分析与导入方案（`rules-absorption-analysis.md` + `rule-model-v3-design.md`）
- [x] 分片 1 规则模型 v3 阶段 1–4（ScanContext/ignoreTerms/density/handler）
- [x] 分片 1 A 线：校准规则导入 + SKILL.md（`PLAN-A-rules-and-prompts.md`）
- [x] 分片 1 B 线：用户状态层 + status/config + detect（`PLAN-B-coding-handoff.md`，交外部 Agent）
- [ ] 分片 2 实施
- [ ] 分片 3 实施
- [ ] contributions 数据模型对 Task 12 统一模型的映射设计
- [ ] 后置：banned-words 逐词差集（独立任务）；复读/截断退化检测（后续批次，见 `rule-curation-open-questions.md`）

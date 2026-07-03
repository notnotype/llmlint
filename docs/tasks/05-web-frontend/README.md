# llmlint 检测网页（web frontend v1）

## Relative documents refs

- 检测引擎（复用）：`skill/src/scanner.ts`（`scanText`）、`skill/src/markdown-mask.ts`（`computeMaskedRanges`）、`skill/src/rules.ts`（`loadRules`）。
- 规则系统背景：[Task 02 llmlint Rule Registry](../02-llmlint-rule-registry/README.md)。

## User Request / Topic

给 llmlint 提供一个前端页面。**第一版只负责检测，不负责跑 agent 来修复**。项目架构复用 NeuroBook 的框架（Nuxt、Zod）。先讨论再实现。

## Goal

/goal 做一个纯检测的 llmlint 网页：贴中文文本 → 实时看到 regex 规则命中（分组、行列、上下文、级别/受众/修复维度、规则详情），可按受众/级别/命名空间过滤、可切 Markdown 遮罩。verified by `vue-tsc` 0 错误 + `nuxt generate` 出可部署静态站 + 无头冒烟确认检测/遮罩结果正确。constraints：不改 `skill/` 引擎、不做 `fix`/agent/后端/登录/持久化。

## Decisions / Discussion

讨论后与用户确认两条关键决策（AskUserQuestion）：

1. **检测在哪跑 → 客户端静态**。构建期跑一次 `loadRules(默认配置)` 把规则预烘成 `registry.json`，浏览器只 import 它 + 调纯函数 `scanText`/`computeMaskedRanges`。`ssr:false` + `nuxt generate` 出纯静态站。理由：纯检测工具（eslint/prettier playground 形态）天生适合客户端——静态托管零后端、稿件不上传（隐私）、边打字边标即时、可离线。不选服务端 Nitro API（要常驻服务、稿件发后端、有延迟）。
2. **结果展现 → 两者都做，先做 issue 列表**。v1 先出仿 CLI 的命中列表；Grammarly 式行内高亮作为同一任务的第二阶段。

**引擎接缝（关键发现）**：`scanText` / `computeMaskedRanges` 是纯函数（只吃字符串、零 Node 依赖），浏览器可直接跑；只有 `loadRules` 读文件系统，且只需构建期跑一次。因此**不用改引擎**——加一个预烘脚本即可。

**zod 的诚实定位**：纯客户端检测这版 zod 不是承重件（数据是可信构建产物、输入只是字符串）。暂未强塞；留给后续「分享链接/本地存储状态校验」或「config 编辑器」时使用。

## Current State

v1（issue 列表）→ 第二阶段（Grammarly 式行内高亮）→ 三阶段体验优化（①列表↔正文双向定位、②一键机械修复+复制JSON、③部署+首屏说明+meta+评测报告数据预烘）→ **主题 / i18n / 设置 / 规则覆盖配置**均已实现。当前 Web 支持浏览器本地设置：语言、主题、检测默认筛选、行内高亮、Markdown 遮罩，以及 namespace/rule 级启停、level/review/fixability 覆盖。检测首页已改为双状态：第一状态为介绍 + 可拖拽文本文件的输入区，提交后带动画进入左右分屏检测工作台。验证：`bun test`、根 `typecheck`、`web:typecheck` 通过；本轮 `web:generate` client/server build 通过，但最后 `.output` 被已有 dev 进程文件锁占用导致 rmdir EBUSY，未自动停止用户可能正在使用的 dev server。

## Implementation Walkthrough

### 架构与目录

新目录 `web/`（独立 Nuxt 4 SPA），引擎从 sibling `../skill/src` 经 alias `llmlint` 导入：

- `web/nuxt.config.ts`：`ssr:false`；`alias.llmlint → ../skill/src`；`vite.server.fs.allow` 放开仓库根（dev 时允许 import web/ 外的 skill 源码）；modules `@unocss/nuxt` + `@nuxtjs/color-mode`。
- `web/uno.config.ts`：`presetUno() + presetIcons()`（对齐 NeuroBook），只 safelist 用到的 lucide 图标。
- `web/scripts/build-registry.ts`：预烘脚本。跑 `loadRules(默认配置)`，把 `regexRules`（含全部元数据）+ `llmRules` + `summary` + `diagnostics` 序列化成 `app/data/registry.json`。`dev`/`build`/`generate`/`typecheck` 都用 `bun scripts/build-registry.ts && …` 显式前置（不依赖 bun pre/post 钩子行为，fresh clone 也稳）。`node_modules` 与 `registry.json` 均 gitignore。
- `web/app/types.ts`：复用引擎类型（`Issue`/`RegexRuleRecord`/`LLMRuleRecord`/…）+ UI 类型（`UiFilters`/`RuleGroup`/`LlmlintRegistry`）。
- `web/app/composables/useLlmlint.ts`：客户端检测核心（纯计算）——`scan`（scanAll 时跳过遮罩）、`applyFilters`、`summarize`、`groupByRule`、`namespaceOptions`。受众/级别/命名空间过滤是对命中列表的纯数组操作，不碰引擎。
- `web/app/app.vue`：页面组合（输入 → 扫描 → 过滤 → 分组 → 展示）。
- 10 个组件 `web/app/components/`：`AppHeader`、`TextPanel`（含示例文本 + 行内高亮开关 + Markdown 遮罩开关）、`HighlightedTextarea`（行内高亮背板叠加）、`FilterControls`、`SummaryBar`、`IssueList` + `IssueCard`、`DimensionBadges`、`RuleDetailDialog`、`LlmRulesPanel`（只读列出「需 Agent 语义判断、本页不检测」的 llm 规则，对范围诚实）。

### 数据流

```
构建期(Node/Bun)：loadRuleCatalog(默认配置) → app/data/registry.json（完整 catalog + 默认 active registry）
浏览器：registry catalog + localStorage 覆盖 → materializeRules(...) → scanText(text, regexRules, {maskedRanges: computeMaskedRanges(text)}) → Issue[]
       → applyFilters（受众/级别/命名空间）→ groupByRule → 渲染
```

### 第二阶段：行内高亮（Grammarly 式）

在正文里直接标出命中，跟随「过滤后命中」实时更新。技术采用**背板叠加**（industry-standard）：

- `web/app/components/HighlightedTextarea.vue`：一个文字透明、只显示命中底色的「背板 div」在下，一个透明底、文字可见的 `textarea` 浮在上；两者共用同一套排版盒模型（padding/字体/行高/`whitespace-pre-wrap`/`break-words`），`textarea` 滚动时同步背板 `scrollTop/Left` → 底色恰好落在命中词下方。级别配色 high 红 / medium 琥珀 / low 灰。
- **偏移反算**（`useLlmlint.issueRanges`）：`scanText` 的 `Issue` 只给 `(line, column)`（column 是 1-based 码点列），不给绝对偏移。用 `columnToOffset` 从行首前进 `column-1` 个码点得到 UTF-16 起点，`+ issue.match.length` 得终点，再把重叠区间合并（取最高级别）。已用无头脚本对含 emoji（surrogate pair）的样本验证 12/12 反算精确、`slice === match`。
- `TextPanel.vue` 改用 `HighlightedTextarea` 并加「行内高亮」开关（默认开，关掉传空区间）；`app.vue` 把 `filteredIssues` 经 `issueRanges` 传下去，高亮与右侧列表严格一致。

### 计划出入（如实记录）

- **Workflow fan-out 失败，回退 inline**：按 ultracode 用 Workflow 并行「author→review」9 个组件，但 9 个 author agent **全部撞上服务方 429（rate limit）**，`subagent_tokens=0`、无文件落地。没有空转重试，改为**我按同一份契约 inline 写 9 个组件**——结果确定、可控。契约（类型、props/emits、UnoCSS/暗色约定、可用 lucide 图标白名单）本身有效，只是编排链路被限流。
- 「行内高亮」按用户「先做列表」分两阶段推进：v1 出 issue 列表，第二阶段（本轮 goal 模式）补行内高亮，均已完成并浏览器验证。
- 根 `package.json` 加了便捷脚本 `web:dev` / `web:generate` / `web:typecheck`（cd web 转发）。

### 2026-07-01 整体审查收口

走查了 web 全链路（预烘/引擎 import/组合式/组件/config/部署/文档），修掉几处不通顺：

- **构建脚本改显式 `&&` 链**：原用 `predev`/`prebuild`/`pregenerate` 钩子，依赖 bun pre/post 行为；改为 `dev`/`build`/`generate`/`typecheck` 都 `bun scripts/build-registry.ts && …`，fresh clone / 直接 `vue-tsc` 也不会因缺 `registry.json` 挂。
- **删无用依赖 zod**：客户端检测这版没用到；等以后加分享链接/状态校验再引。
- **`uno.config.ts` 清理**：删掉已失效的 `import {icons as lucideIcons}`（旧全量 safelist 遗留），safelist 从 17 个收窄到实际用到的 9 个 lucide 图标。
- **部署提示**：`nuxt.config.ts` 加注释——部署 GitHub Pages 项目页需设 `app.baseURL:"/llmlint/"`，否则 `_nuxt` 资源 404。
- **AGENTS.md / CLAUDE.md** 补 `web/` 模块说明（构建预烘 + 命令），让后续 agent 知道它存在、怎么跑。
- 保留 `playwright-core`（devDep）供按需浏览器验证；无头验证脚本一次性、跑完即删，不入库。
- 确认：无残留临时文件（`_verify`/`_smoke`/`_shot*` 已删），`.output`/`.nuxt`/`node_modules`/`registry.json` 均被 `web/.gitignore` 覆盖，`web/app` 无 `any`（唯一 `as unknown as` 是 registry.json 的受控断言）。

### 2026-07-01 三阶段体验优化（①②③全部完成）

按三阶段计划推进（列表↔正文联动 → 机械修复/复制JSON → 部署/首屏）。

**阶段①：列表↔正文双向点击定位（完成）**
- `useLlmlint` 导出 `offsetOf`/`issueAtOffset`（复用私有 `columnToOffset`/`utf16LineStarts`）。
- `HighlightedTextarea` 加 textarea ref、`locateOffset` prop（定位滚动+闪烁背板段）、`caret-click` emit（读 `selectionStart`）。
- `IssueCard` 命中行可点（`locate-issue`）+ `activeRuleId` 激活环；`IssueList` 透传并把激活卡片 `scrollIntoView`。
- 编排在 `pages/index.vue`。验证：Playwright——点列表命中→左侧 1 段闪烁 + 卡片激活环（1.1s 后消失）；光标落命中内→对应卡片激活。截图确认高亮像素级对齐。

**阶段②：一键机械修复 + 复制 JSON（完成）**
- **抽取 `skill/src/fix.ts`**：`applyAutoFix`/`applyRulesToText` 从 `cli.ts` 移出并导出，CLI 改 `import`；系统性去重，CLI 与 web 共用同一份。skill `bun test` 64 passed、typecheck 0。
- `useLlmlint` 加 `autoFix`（filter `fixability:auto` + `applyAutoFix`，count 用只跑 auto 的 `scanText`）与 `buildReport`（CLI 同构 `CheckJsonReport`）。
- 新增 `useToast`（全局单例，带「撤销」动作）+ `ToastHost`；`TextPanel` 加「清理机械问题 (N)」；`SummaryBar` 加「复制 JSON」。示例文本加 `？？？`/零宽演示。
- 验证：headless smoke——3 auto 规则、prose `？？？`/零宽被清、代码块 `？？？` 遮罩保护。Playwright——清理按钮显示 (2)、点击后 prose 清除 + toast「已清理 2 处」、撤销精确还原、复制 JSON 剪贴板得合法 `CheckJsonReport`(26KB)。

**阶段③：部署 + 首屏说明 + meta（完成）**
- **首屏说明** `AboutPanel.vue`：`AppHeader` 加「?」按钮开说明浮层——是什么/怎么用/`级别·受众·修复`三维含义/核心心智「**命中是候选，不是定论**」+ 仓库链接。踩坑：`AppHeader` 的 `backdrop-blur` 会成为后代 `position:fixed` 的包含块，导致面板相对顶栏而非视口定位（✕ 落在视口外）——用 `<Teleport to="body">` 把浮层挂到 body 根解决，并加 Esc 关闭。
- **meta / 首屏** `nuxt.config.ts`：`app.baseURL = process.env.NUXT_APP_BASE_URL ?? "/"`（GH Pages 项目页构建期传 `/llmlint/`）；补 `description` / `og:*` / `lang=zh-CN` / 内联 SVG data-URI favicon（琥珀底白 L，免额外文件）。
- **部署** `.github/workflows/deploy-web.yml`（新）：push（paths `web/**`、`skill/**`、`evals/report/**`、本 workflow）或手动 → `bun install` + `NUXT_APP_BASE_URL=/llmlint/ bun run generate` → `upload-pages-artifact` + `deploy-pages` 发 `web/.output/public`。
- **评测报告数据预烘**（顺手补齐）`web/scripts/build-report.ts`（新）：把 `evals/report/report.json` 校验后拷到 `web/public/report.json`（缺失则 `existsSync` 跳过，不阻断构建）；`dev`/`build`/`generate` 脚本链加 `build:report`。`public/report.json` gitignore。`pages/report.vue` 加「加载内置示例报告」按钮，`fetch(baseURL + report.json)` → `new File([blob])` → 复用用户既有 `loadFile` 校验，非侵入。
- 验证：`bun run generate` exit=0；`NUXT_APP_BASE_URL=/llmlint/` 构建后 `index.html` 资源带 `/llmlint/_nuxt/` 前缀、`report.json` 随站点发布。Playwright（node）ALL PASS：`aboutOpen`/`aboutHasMindset`（「命中是候选」文案）/`dropVisible`/`reportLoaded`/`ruleTableRows=123`。截图人工过目：About 面板与报告页（AI 检测器 0.833、模型排名、规则体表 123 行）渲染正确。
- **留给用户的决策点**：GH Pages 需仓库公开或 GitHub Pro，并在 Settings → Pages 把 Source 设为「GitHub Actions」；实际 commit / CI 触发由用户决定。MSYS 提示：本地 Git Bash 跑 `NUXT_APP_BASE_URL=/llmlint/` 会被路径转换污染成 `C:/.../llmlint/`，需 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"`；CI（Ubuntu）不受影响，workflow 无需改。

**MSYS baseURL 注意**：见上。

**并发说明**：实现中用户并行把应用路由化（`app.vue`→`<NuxtPage/>`、`pages/index.vue` + 计划中 `pages/report.vue` 评测报告查看器、`AppHeader` 加 检测/报告 导航且 `registry` 可选、`nuxt.config` 加 `evals` alias、新增 `report-types.ts`、`tsconfig` 置空 `vueCompilerOptions.plugins` 消 vue-router volar 警告）。①② 与其无冲突且已被保留/集成；combined `vue-tsc` 0 错误、`nuxt generate` 通过。

### 2026-07-01 主题 / i18n / 设置 / 规则配置

用户要求参考 NeuroBook 接入主题系统和 i18n、加入设置界面、复制瘦身 common 组件并优化 UI/UX。确认“主体系统”实际指“主题系统”；设置形态选择顶栏弹窗；规则配置纳入第一版。

- **主题系统**：新增 `web/app/utils/theme/*` 与 `useLlmlintTheme()`，使用 `.llmlint-theme` 宿主 + CSS variables（`--bg-*` / `--text-*` / `--border-*` / `--accent-*` / status 色）。支持 `system` / `light` / `dark` / `sepia`，并同步 Nuxt color-mode 的 light/dark class 作为兼容层。
- **i18n**：新增 `web/app/i18n/messages.ts`、`locales/*` 与轻量 `useLlmlintI18n()`，UI 文案从组件内抽出；语言保存到 `llmlint.webSettings.v1`，插件同步 `<html lang>`。计划中的 `@nuxtjs/i18n` 依赖安装三次均卡在 `bun add ... Resolving dependencies`，本轮没有把模块写入 `nuxt.config.ts`，保留可迁移的 `i18n.config.ts` 文件边界。
- **设置弹窗**：新增 `SettingsDialog.vue` 与 `useWebSettings()`，顶栏齿轮打开；分区为「界面 / 检测 / 规则」。界面设置控制语言和主题；检测设置控制 review、minLevel、namespace 过滤、行内高亮、Markdown 遮罩；规则设置支持 namespace/rule 的 enabled、level、review、fixability 覆盖和重置。
- **规则 registry 重构**：新增纯函数 `skill/src/rule-registry.ts#materializeRules`；`skill/src/rules.ts#loadRuleCatalog` 负责读完整 catalog，`loadRules` 保持 CLI 行为不变并委托纯函数。`web/scripts/build-registry.ts` 现在输出完整 catalog + 默认 active registry，浏览器按 localStorage 覆盖重新 materialize active `regexRules` / `llmRules` / `summary`。
- **common/UI**：新增轻量 common 组件 `Dialog`、`IconButton`、`SegmentedControl`、`FormSelect`、`SwitchField`、`NotificationViewport`；`AboutPanel` / `RuleDetailDialog` / `SettingsDialog` 统一 Dialog，旧 `useToast` 路径替换为 `useNotification`，保留机械清理撤销动作。
- **计划出入**：没有自动做浏览器验证，符合本仓 AGENTS「不要自动进行浏览器验证」要求；`web:generate` 本轮失败点是 `.output` 文件锁，不是编译错误。没有擅自停止已有 `bun run dev` 进程。

### 2026-07-01 主题/设置深度审查修复

继续按用户要求从链路走查任务遗漏，补齐三处实现与计划/CLI 语义不一致：

- **规则 review 覆盖收紧**：`web-settings.ts` 拆分 `FILTER_REVIEWS` 与 `RULE_REVIEWS`。界面检测过滤仍允许 `review: "all"`；namespace/rule override 只允许规则本体合法的 `agent` / `human` / `none`，避免 localStorage 旧值把 `"all"` materialize 进规则 registry，导致规则在过滤下消失或 badge 显示 `undefined`。
- **namespace 级覆盖 UI 补齐**：`SettingsDialog` 的 namespace 行从只有 enabled/default/on/off，补为与 rule 行同能力：enabled + level + review + fixability + reset，满足“namespace/rule 启停、level/review/fixability 覆盖”的计划口径。
- **复制 JSON 过滤统计对齐 CLI**：`useLlmlint.buildReport` 改从全量命中出发，按 CLI 顺序先 review、再 level 计算 `hiddenByReview` / `hiddenByLevel`，最后再套 Web 额外的 namespace 视图过滤；`pages/index.vue` 调用点改传 `allIssues`。复制出的 `CheckJsonReport` 不再固定显示隐藏统计为 0。
- **Nuxt auto-import 警告清理**：去掉 `useWebSettings` 对 `LlmlintWebSettings` / `WebRuleOverride` 的重复类型 re-export，组件直接从 `utils/web-settings.ts` 引类型，`web:generate` 不再出现 duplicate imports warning。

## Verification / Test

- `web` 目录 `nuxt prepare` 通过；`llmlint/*` alias 已进生成的 tsconfig paths。
- **`vue-tsc --noEmit`：0 错误**（全应用类型通过）。
- **`nuxt generate`：成功**，产出可部署 `.output/public`（index/200/404），浏览器主 chunk 87.7KB gz（含 Vue + 引擎 + registry）。
- **无头检测冒烟**（临时脚本，跑完删除）：示例文本遮罩模式 23 处 / scan-all 24 处；代码块内「其实」在遮罩下被正确跳过、scan-all 下出现（差值恰为 1，遮罩生效）；命中命名空间为 `contrast.binary`/`filler`/`jargon.business`/`punctuation.dash`/`transition.summary` 等，符合预期。另用脚本验证 `(line,column)→UTF-16 offset` 反算 12/12 精确（含 emoji surrogate-pair 行）。
- **浏览器验证（Playwright + headless chromium，临时脚本 + 截图，跑完删除）**：`nuxt preview` 静态站上，载入示例后 review=agent 默认「共 18 处 / 12 卡片」、切「全部」→「共 24 处 / 14 卡片」（过滤生效）；行内高亮 9 个背板着色段、右侧列表 18 个 `<mark>`；暗色切换 `html.dark` 生效；规则详情弹窗打开显示「匹配模式」。三张截图人工过目：行内高亮**像素级对齐**在 `不是…而是`/`综上所述`/`前所未有` 上、代码块 `其实` **未**高亮（遮罩可见生效）、暗色与弹窗（id/命名空间/来源/badges/note/正则/修复动作）渲染正确。
- 说明：Playwright 在 **bun** 下 launch 会卡 remote-debugging-pipe（Windows 已知问题），改用 **node** 跑验证脚本即正常。
- **2026-07-01 主题/设置轮验证**：`bun test` 67 passed（新增 browser `materializeRules` 与 Web 设置归一化测试）；`bun run typecheck` 通过；`bun run web:typecheck` 通过（仍有既有 `[Vue] Load plugin failed: vue-router/volar/sfc-route-blocks` 提示但无 TS error）；`bun run web:generate` client/server build 通过，最终因 `.output` 被现有 dev 进程锁住而 EBUSY 退出。
- **2026-07-01 审查修复验证**：`bun test` 67 passed（补 `review:"all"` 只能作为过滤值、不能作为规则 override 的回归断言）；`bun run typecheck` 通过；`bun run web:typecheck` 通过（仍有既有 Vue Volar 插件提示，无 TS error）；`bun run web:generate` client/server build 通过，duplicate imports warning 已清除，最后仍因 `web/.output` 被 Windows 文件锁占用而 EBUSY 退出；未擅自停止可能正在运行的 dev 进程。

### 2026-07-01 首页双状态调整

按用户要求把检测页首页从直接左右分屏改为两个状态：

- 第一状态：介绍 + 大文本输入区，支持粘贴、拖入 `.txt/.md` 文件、点击选择文件和载入示例。
- 第二状态：提交后进入原有左右分屏，左侧继续复用 `TextPanel` / 行内高亮 / 机械清理，右侧展示过滤、摘要、规则命中和 LLM 规则审查。
- 状态切换：`pages/index.vue` 维护 `hasStarted`，提交后展示 workbench；文本清空后回到首页。`Transition` + 局部 keyframes 让输入区从中间轻微滑入左侧，右侧报告区随后淡入。
- 实现：新增 `HomeInputPanel.vue`，示例文本抽到 `app/utils/sample-text.ts`，`TextPanel` 与首页共用同一份示例。
- 验证：`cd web && bun run typecheck` 通过；仍有既有 `[Vue] Load plugin failed: vue-router/volar/sfc-route-blocks` 提示，但退出码 0。未自动做浏览器验证。

### 2026-07-01 首页审查修复

审查后修复两处任务遗漏：

- 新增首页、账号菜单和 `FormSelect` fallback 文案接入 `useLlmlintI18n()` / `messages.ts`，不再绕过语言设置。
- 文件选择后清空 input value，确保重复选择同一个 `.txt/.md` 文件也会触发读取。
- 验证：`cd web && bun run typecheck` 通过；仍有既有 Vue Volar 插件提示，退出码 0。未自动做浏览器验证。

## TODO / Follow-ups

- [x] 第二阶段：Grammarly 式**行内高亮**叠加层（背板叠加 + 偏移反算，已实现并浏览器验证）。
- [x] 列表↔正文双向点击定位（阶段①）。
- [x] 复制 JSON（`CheckJsonReport` 形态）+ 一键机械修复（auto 桶，含撤销）（阶段②）。
- [x] 部署（GitHub Pages workflow）+ 首屏说明（AboutPanel）+ meta（baseURL/head/favicon）+ 评测报告数据预烘（阶段③）。实际 commit / CI 触发 + 仓库转公开/Pro + Pages Source 设置留待用户。
- [ ] 示例集扩充。
- [ ] 可选：行内命中 hover 悬浮提示（需处理背板 pointer-events 与 textarea 编辑冲突）。
- [x] 本地浏览器设置：主题 / 语言 / 检测默认值 / namespace+rule 覆盖配置。
- [ ] 可选：分享链接 / 本地存储状态导入导出（此时引入 zod 校验状态形态）。
- [ ] 可选：完整 config 编辑器（新增规则、编辑正则 target、导入外部 ruleset；当前只做覆盖配置）。
- [x] 浏览器人工验收（Playwright headless chromium，三张截图确认布局/高亮对齐/遮罩/暗色/弹窗）。

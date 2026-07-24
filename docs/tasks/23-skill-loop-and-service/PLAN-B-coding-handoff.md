# Task 23 分片 1 · B 线任务书：skill 编码收尾（交付外部编码 Agent）

> 仓库：`llmlint`（本仓库根）。本文档是自包含任务书：不需要读会话历史，按此执行。
> A 线（规则导入 + SKILL.md 提示词工程）由另一条会话负责，见 `PLAN-A-rules-and-prompts.md`——**不要动 A 线的文件**。

## 0. 背景与现状（必读）

llmlint 是「中文 AI 腔检测 + 修复」工具，`skill/` 是自包含 CLI 包（bun 运行），`web/` 是 Nuxt 消费端，`evals/` 是评测代码。Task 23 分片 1 的规则模型 v3 改造（阶段 1–4）**已完成并全绿**：

- `skill/src/scan-context.ts`：`prepareScanContext(content, {maskedRanges?, ignoreTerms?}) → ScanContext`（三层等长视图 all/narrative/dialogue、成对引号区间、结构行标记、豁免词区间）；工具 `visibleLength` / `computePositionWindow` / `overlapsRanges`。
- `skill/src/scanner.ts`：`scanWithContext(ctx, regexRules)`（scope 分层 + position 窗口）、`scanHandlerRules(ctx, handlerRules)`、旧签名 `scanText` 薄包装；导出 `buildLineStarts` / `locatePosition` / `ensureGlobalFlags`。
- `skill/src/density.ts`：`scanDensity(ctx, densityRules) → DensityIssue[]`（门槛 AND、结构行/遮罩/豁免跳过、doc/paragraph 粒度）。
- `skill/src/handler-rules/index.ts`：`HANDLER_REGISTRY` 具名注册表，已含 4 个 handler（not-is-comparison / period-stutter / overcompressed-prose / low-connective-density，移植自 story-deslop，MIT）。
- `skill/src/rules.ts` loader：scope 校验；不变量 `fixability auto/candidate ⇒ scope 全域`（违者降 manual + error 诊断 `scoped-rule-not-auto-fixable`）；density 校验 + `density-rule-not-fixable`；未知 `detector.type` / 未注册 handler 名 → skip + warning 诊断（`unknown-detector-type` / `unknown-handler-name`），不抛错。
- `skill/src/types.ts`：`ScanScope` / `DensityDetector` / `DensityIssue` / `HandlerRuleRecord{handler:{type:"builtin",name}}` / `RuleHandler` / `HandlerFinding`；`ActiveRuleRecord` 是声明式∪handler 联合；`Issue.rule` 是 `RegexRuleRecord | ActiveHandlerRuleRecord`，新增 `Issue.detail?`；`LoadedRules` 含 `densityRules` / `handlerRules`；config 增 `ignoreTerms`。
- `skill/src/cli.ts` check 已串三种 detector；fix 把 ignoreRanges 并进遮罩段；reporter 有密度指纹段与 detail 行。
- 测试：`tests/scan-context.test.ts`（17 例）、`tests/density.test.ts`（10 例）全绿；全仓 `bunx vitest run` 248 例通过。
  已知既有失败：`tests/agent-invocation-revision-migration.test.ts` 用 `bun:test`，vitest 跑不了——与你无关，不要修。

## 1. 硬约束

1. skill 包自包含：`skill/src` **不得 import** `evals/` 或 `web/` 的代码；移植代码复制过来并在文件头注明出处。
2. 纯函数底线：`scanText` / `materializeRules` / scan-context / density / handler 保持纯函数（浏览器可打包）。你的新代码里只有 user-state / cache / CLI 层允许碰文件系统与网络。
3. 不要动这些文件（A 线负责）：`skill/rulesets/**`、`skill/SKILL.md`、`skill/references/**`、`docs/**`、`CONTEXT.md`、`PROJECT-STATUS.md`。
4. 不 git commit / push。
5. 代码风格：4 空格缩进、中文注释（每个导出函数写规范注释）、避免 `any`/`unknown`（用了要注明原因）、不过度抽象（单处逻辑 inline）、简单逻辑不写测试但下述指定的测试必须写。
6. Windows + bun 环境；安装依赖用 `bun add`（在 `skill/` 目录内装，保持包自包含）。

## 2. 任务 B1：handler 管线测试（小，先做热身）

新建 `tests/handler-rules.test.ts`（仿 `tests/scan-context.test.ts` 风格）：

1. `scanHandlerRules` 映射：构造一个 `ActiveHandlerRuleRecord`（`handler:{type:"builtin",name:"not-is-comparison"}`、`action:{type:"suggest",message:"…"}`、`fixability:"manual"`），对文本 `"这不是普通的雨，而是一场预谋。"` 扫描，断言 Issue 的 line/column/endLine/endColumn、`target === "not-is-comparison"`、match 为原文切片。
2. 引号豁免：`"「不是我干的，是他。」"` → 0 命中（dialogueRanges 豁免）。
3. `detail` 字段：用 `period-stutter`（6 个 ≤5 字短句连排，如 `"他站住。风停了。灯灭了。门开了。人走了。夜深了。"`）断言产出 Issue 且 `detail` 含「连续 6 个短句」。
4. ignoreTerms 过滤：豁免词区间与 handler 命中重叠时命中被丢弃（`prepareScanContext(content, {ignoreTerms:[…]})`）。
5. loader 正路径：写临时 ruleset（模式照抄 `tests/density.test.ts` 的 `test-density`，用独立 id 如 `test-handler-plumb` 防并发撞目录），一条 builtin handler 规则 → `loadedRules.handlerRules` 长度 1、`fixability === "manual"`；声明 `fixability:"auto"` 的 handler 规则 → 诊断 `handler-rule-not-fixable` + 结果仍 manual。

注意：**不要**写校准例句矩阵（真人语料 0 命中类断言）——那是 A 线的活。

## 3. 任务 B2：用户状态层 + `status` / `config` 命令

### 3.1 `skill/src/user-state.ts`（新建）

用户级状态目录：`~/.llmlint/`（`os.homedir()`）；**必须支持环境变量 `LLMLINT_HOME` 覆盖**（测试与多环境用）。

`settings.json` 归一形态（全部字段有默认值，文件缺失/字段缺失都回默认；未知字段报错）：

```jsonc
{
    "version": 1,
    "initialized": false,          // 五步流程的初始化门；status 输出它，init 流程用 config set 写 true
    "sharing": {
        "tier": "fragments",       // "off" | "stats" | "fragments" | "full"（默认 fragments，已拍板）
        "mode": "ask",             // "auto" | "ask"（默认 ask，已拍板）
        "anonymous": false
    },
    "detector": {
        "proxy": null,             // string | null；null = 直连
        "space": "yuchuantian-aigc-text-detector.hf.space",   // 与 evals/detector/hf-client.ts 的 DEFAULT_SPACE 一致
        "chunkChars": 450,
        "minIntervalMs": null      // null = 用移植源默认；具体默认值以 hf-client.ts 现值为准
    }
}
```

`auth.json` 本分片只定形状不实现登录（分片 3 做设备码流）：`{version: 1, passport: null}`，类型里写好 `passport` 的形状注释（accessToken/refreshToken/expiresAt/accountLabel）。

API（全部带中文规范注释）：
- `loadUserSettings(): UserSettings` — 读 + 校验 + 补默认；损坏 JSON 抛带路径的错误。
- `saveUserSettings(settings: UserSettings): void` — 全量写回（4 空格缩进 JSON + 尾换行）。
- `userStateDir(): string` — `LLMLINT_HOME` > `~/.llmlint`；不存在时惰性 mkdir。
- 类型 `UserSettings` 放本文件导出（不进 types.ts——它不是规则模型的一部分）。

### 3.2 CLI 命令（`skill/src/cli.ts`）

- `llmlint status [--format json]`：Agent 判断初始化状态的唯一入口。JSON 形态：

```jsonc
{
    "kind": "status",
    "version": "<LLMLINT_VERSION>",
    "initialized": false,
    "login": "none",               // 分片 3 前恒 "none"
    "sharing": {"tier": "...", "mode": "...", "anonymous": false},
    "configPath": "…/llmlint.config.ts 或 null",   // 复用 loadConfig 的探测
    "detector": {"space": "...", "proxyConfigured": false, "cacheDir": "…/.llmlint/cache"}
}
```

  stylish 输出人话版（每行一项）。status 不要求任何文件预先存在（首跑=全默认 + initialized:false）。

- `llmlint config get [key]` / `llmlint config set <key> <value>`：读写 settings.json，key 用 dot-path 白名单硬校验，白名单外报错并列出合法键：
  `initialized`（bool）、`sharing.tier`（枚举）、`sharing.mode`（枚举）、`sharing.anonymous`（bool）、`detector.proxy`（string；空串或 `null` 字面量=清除）、`detector.space`（string）、`detector.chunkChars`（正整数）、`detector.minIntervalMs`（非负整数或 `null`）。
  `config get` 无 key 时输出整份归一 settings（JSON）。值解析：`true/false` → bool，数字串 → number，其余按 string。set 成功后回显 `key = value`。
  注意与既有项目级 `llmlint.config.ts`（规则覆盖）的分界：`config` 子命令**只**管用户级 settings.json，不碰 llmlint.config.ts；命令 help 文本里写清这一点。

### 3.3 测试（`tests/user-state.test.ts`）

设 `LLMLINT_HOME` 指向 mkdtemp 临时目录（afterEach 清理 + 还原环境变量）：
- 首读全默认；set 后 get 往返一致；重复 set 幂等。
- 白名单外 key、枚举外 value、非整数 chunkChars 各自报错。
- `runCli` 层：`status --format json` 输出可 `JSON.parse` 且 initialized 默认 false（mock console.log 收集输出，模式照抄 `tests/llmlint.test.ts` 里的 CLI 测试）。

## 4. 任务 B3：`detect` 命令（神经检测直连）

### 4.1 移植源（复制改造，不 import）

- `evals/detector/chunk.ts` → `skill/src/detect/chunk.ts`：`chunkBySentence(text, targetChars, minTailChars)` 与 `visibleLen` 原样移植，文件头注明「移植自 evals/detector/chunk.ts」。
- `evals/detector/hf-client.ts` → `skill/src/detect/transport.ts`：抽出 `DetectorTransport` 接口 + `HfTransport` 实现（gradio 协议 POST→event_id→SSE、串行 + 最小间隔限速 + 退避重试、`toPAi` 归一、长度加权 mean + max 聚合）。接口先行是拍板决策：将来登录用户切服务端通道只换实现。

```ts
/** 神经检测传输层：输入分块文本，输出每块 P(AI)。实现负责限速/重试。 */
export interface DetectorTransport {
    detectChunks(chunks: string[]): Promise<number[]>;
}
```

- 代理：参考 `web/server/utils/detect.ts` 的 node-fetch-native 方案——`cd skill && bun add node-fetch-native`，`createFetch({url: proxy})`；settings.detector.proxy 为 null 时直连。网络错误信息里提示：`可运行 llmlint config set detector.proxy http://127.0.0.1:7890 配置代理`（国内直连 HF 通常不通）。

### 4.2 缓存 `skill/src/detect/cache.ts`

content-hash sidecar：`sha256(算法口径 + space + chunkChars + 正文)` → `<userStateDir>/cache/<hash>.json`，内容为完整 detect 结果 + 生成时间。命中即不发网络。`--no-cache` 跳过读取但仍写入。参考：`evals/detector` 已有 sidecar 缓存实现可借鉴口径。

### 4.3 CLI

`llmlint detect <files...> [--format json] [--no-cache]`：

```jsonc
{
    "kind": "detect",
    "files": [{
        "filePath": "...",
        "docPAi": 0.87,          // 长度加权平均
        "maxPAi": 0.99,
        "cached": true,
        "chunks": [{"span": [0, 448], "pAi": 0.91, "line": 1}]   // span=原文偏移；line=块起点行号
    }]
}
```

stylish：每文件一行总分 + 「热区」列表（pAi ≥ 0.85 的块，显示行号区间与前 30 字预览）。多文件串行（transport 内已限速）。文件展开复用 `cli.ts` 现有 `expandInputs`。

### 4.4 测试（`tests/detect.test.ts`，纯函数面）

- chunk：句界切分边界（450 字目标、短尾并入）、空文本、无句读长串。
- `toPAi` 归一口径与 `aggregate`（加权 mean/max）——从移植源把既有断言口径搬过来。
- cache：写→读往返、口径变化（space 不同）不命中。
- 网络层（HfTransport 的 fetch 部分）**不做单测**；真跑验证见 §5。

## 5. 验证（完成定义）

1. `bunx vitest run` 全绿（除既有 bun:test 文件）；`bunx tsc --noEmit` 0 错误；`cd web && bun run typecheck` 0 错误。
2. `bun skill/bin/llmlint.ts status --format json`、`config set sharing.tier stats`、`config get` 手工冒烟各跑一次（输出贴进交付说明）。
3. `detect`：若环境有代理则对一个小 md 文件真跑一次并验证二次运行 `cached: true`；无代理则跑到「网络错误 + 代理提示」即可，并在交付说明注明未真跑。
4. 交付说明写明：实际改动文件列表、与本任务书的出入、遗留问题。

## 6. 明确不做

- 规则 JSON 导入、namespaces 策略表新条目、SKILL.md / references 改写（A 线）。
- `login` 设备码流、contributions 上传（分片 2/3）。
- 修 `tests/agent-invocation-revision-migration.test.ts` 的 bun:test 问题。
- git commit / push。

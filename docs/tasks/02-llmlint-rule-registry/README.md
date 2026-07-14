# llmlint Rule Registry

> 来源说明：本任务在 llmlint 还内嵌于 neuro-book 时执行，是规则系统与 CLI 的主设计与实现记录。原文实现日志里大量 neuro-book 资产同步/集成测试细节（`sync-user-assets`、`workspace-files` 测试、user-assets stale 清理、vendored snapshot 对齐）属对方职责，已在此精简；保留 llmlint 自身的设计、决策、规则统计与 CLI/运行时演进。调用路径统一改写为独立仓 `skill/`；旧 Task 51/82/84 交叉引用改为本仓 Task 01/03/04。

## User Request / Topic

围绕 `llmlint` 的下一阶段规则系统设计：从当前 `static-rules.json` / `llm-rules.json` / `category-suggestions.json` 的分裂结构，升级为可融合多来源规则包的扁平化 Rule Registry。

用户提供了 `旧中文规则样本目录` 作为真实规则样本，包含 Claude / Gemini / deepseek / 通用 / 轻量等多个规则包。样本呈现出“规则包 -> 分类组 -> subRules”的来源形态，但长期设计应转为一条规则一条记录，便于检索、合并、覆盖和用户安装。

## Goal

设计并实现 llmlint 的规则注册表：

1. 规则记录扁平化：一个 lint 规则就是一条独立记录。
2. 支持多个已安装 ruleset，自由组合启用。
3. `id` 全局唯一，用于定位具体规则来自哪个规则包、哪条规则。
4. `namespace` 可重复，用于规则分类、聚合展示和批量覆盖。
5. 不再单独维护 `category` / `subcategory` / `category-suggestions.json`；namespace 承担分类职责。
6. 支持不同规则包向同一个 namespace 追加规则，也支持规则包或用户配置覆盖已有规则。
7. 用户 config 可以自由选择已经安装的 ruleset，并按 namespace 或 rule id 继续覆写。

## Current Decisions

### 2026-06-29 初始设计

**规则身份**
- `id`：全局唯一，定位具体规则。
- `namespace`：非唯一，承担分类、聚合和批量配置职责。
- `ruleset`：可安装、可启用、可组合的规则包来源。
- `category` / `subcategory`：删除，不进入新 schema；如果需要层级分类，用 namespace 字符串表达。

**namespace 语义**
- namespace 不仅能聚合同类规则，也能作为覆盖面。
- 多个规则包可以向同一个 namespace 添加规则，例如 `modifier` 或 `形副词系`。
- 推荐 namespace 使用稳定英文 key；允许中文 namespace 作为导入兼容和本地自用形态。
- 需要 alias / normalization，把常见中文组名映射到稳定英文 key，例如 `形副词系 -> modifier`。
- 同 namespace 不同 id：视为追加规则。
- 同 id：视为覆盖同一条规则，必须提醒用户来源、旧规则与新规则。
- namespace 不负责整组替换；规则融合只按 `id` 判断追加或覆盖。
- namespace 级配置只用于批量启停或调整 level，不改变规则定义本身。

**ruleset 与用户 config**
- 规则包是安装单元；用户 config 只选择已经安装的 ruleset，不直接依赖任意散落 JSON 文件。
- config 可以按 ruleset、namespace、rule id 三层配置。
- 推荐覆盖优先级：rule id override > namespace override > ruleset setting > rule 默认 enabled / level。
- 规则加载需要产出 summary：启用了哪些 ruleset、每个 namespace 聚合了多少规则、发生了哪些覆盖或冲突。

**规则融合**
- 加载顺序由用户 config 中的 `rulesets` 顺序决定。
- 新 id append；同 id override 旧规则并产生 diagnostics；最终 registry 中同一 id 只保留最后加载的规则，diagnostics 记录被覆盖来源。

**detector**
- v1 只保留两种：`regex`（确定性定位）与 `llm`（需要 Agent / LLM 语义判断）。
- registry 正式格式只接受标准 regex，不支持 `simple` 花括号模板；现有样本的 `text` 在导入时 escape 成 regex；`simple` 必须在导入前转换成标准 regex。

**action**
- v1 只保留两种：`replace`（提供替换候选）与 `suggest`（只提示）。
- 删除类规则用 `replace` 且 `replacements: [""]`；报告层展示为“建议删除”。

**未来扩展**
- 后续可提供自定义代码段类型（handler），用可执行 rule handler 替代 `detector + action`。属高级扩展，v1 只设计 schema、不执行；代码段规则默认不信任第三方 ruleset，用户 config 显式信任后才能执行；handler 沙盒后续优先复用已有沙盒能力。

## Candidate Record Shape

```typescript
type LintRuleRecord = DeclarativeRuleRecord | HandlerRuleRecord;

type BaseLintRuleRecord = {
    id: string;
    namespace: string;
    ruleset: string;
    title: string;
    level: "high" | "medium" | "low";
    enabled?: boolean;
    note?: string;
    examples?: Array<{ bad: string; good?: string; reason?: string }>;
    source?: { version?: string; importedFrom?: string };
};

type DeclarativeRuleRecord = BaseLintRuleRecord & {
    detector:
        | {type: "regex"; targets: string[]; flags?: string}
        | {type: "llm"; prompt: string};
    action:
        | {type: "replace"; replacements: string[]}
        | {type: "suggest"; message: string};
};

type HandlerRuleRecord = BaseLintRuleRecord & {
    handler: { type: "module"; path: string; export?: string };
};
```

handler API 第一版保持很小，只允许检查文本并返回 issue，不直接写文件：

```typescript
type LintRuleHandler = {
    meta?: { description?: string; deterministic?: boolean };
    check(input: LintRuleHandlerInput): Promise<LintRuleIssue[]>;
};

type LintRuleHandlerInput = {
    text: string;
    filePath: string;
    rule: HandlerRuleRecord;
    options: { cwd: string };
};

type LintRuleIssue = {
    ruleId: string;
    namespace: string;
    message: string;
    level?: "high" | "medium" | "low";
    range?: { start: number; end: number };
    suggestions?: Array<{ title: string; replacement?: string }>;
};
```

安全约束：
- `handler.path` 必须是 ruleset 内部相对路径，不能用 `..` 跳出 ruleset。
- handler 不获得 shell、写文件能力或 Agent 工具，只接收文本和规则元数据。
- 未被信任的 ruleset 若含 handler rule，加载时跳过并产生 warning。
- handler rule 返回 suggestion，不直接修改文件。
- 真正执行第三方 handler 前，需要补充 sandbox / trust / deterministic policy。

## Candidate Config Shape

```typescript
type LlmlintConfig = {
    rulesets: string[];
    trustedRulesets?: string[];
    rulesetOverrides?: Record<string, "off" | "on">;
    namespaces?: Record<string, "off" | "low" | "medium" | "high">;
    rules?: Record<string, "off" | "low" | "medium" | "high">;
};
```

示例：

```typescript
export default {
    rulesets: ["builtin/default", "community/claude-daily", "user/local-overrides"],
    trustedRulesets: ["user/local-overrides"],
    namespaces: { modifier: "medium", "vocabulary.r18": "off" },
    rules: { "community.claude.daily.remove-empty-modifier-shell": "off" },
};
```

## Compatibility Notes

- 实现前的 `presets` / `customRules.static` / `customRules.llm` 是过渡结构；本任务已迁移到 `rulesets` + flat rule records。
- 现有 `static-rules.json` 与 `llm-rules.json` 迁移为同一集合的 rule records。
- `旧中文规则样本目录` 中的 `text` / `simple` / `regex` 三类来源格式，先归一化为标准 regex；registry 内不保留 `simple`；`simple` 转换失败不能静默丢弃，必须产生 diagnostics。
- 样本存在 `/.../g` 形式 regex literal，导入器解析为 `pattern + flags`；scanner 支持 detector 自带 flags，而非固定追加 `g`。
- `enabled: false` 的组和“可选”组导入时保留默认 enabled 状态或 profile metadata，不默认全部启用。
- `replacements: []` 表示删除，迁移为 `action: {type: "replace", replacements: [""]}`。
- `category-suggestions.json` 不再独立扩展；有价值建议迁移到具体 rule 的 `action` / `note` / `examples`。
- handler rule 是新能力，第一版迁移不实现 handler 执行。

## Code Feasibility Audit（2026-06-29）

实现前代码适合迁移到 Rule Registry：

- `src/rules.ts` 已用 `Map<string, Rule>` 以 `id` 为键合并规则，与新设计 append / override 语义接近。
- 当前 static / llm 分成两个集合，同 id 跨类型覆盖需互相删除；新 registry 统一为单一 `LintRuleRecord` 集合，再由 detector 类型分流到 scanner 或 LLM 审查输出。
- `src/config.ts` 当时只支持 `presets`、`customRules`、`rules`；现迁移到 `rulesets`、`trustedRulesets`、`rulesetOverrides`、`namespaces`、`rules`。
- `src/scanner.ts` 当时只扫描 `StaticRule.pattern` 且固定 `new RegExp(rule.pattern, "g")`；新 scanner 读取 `detector.type === "regex"` 的 `targets` 和 `flags`。
- `src/reporter.ts` 当时只面向 static issue 和 LLM rule 列表；新 reporter 输出 registry diagnostics（ruleset 覆盖、handler 跳过、导入转换失败、namespace alias 命中）。
- `SKILL.md`、`references/cli-usage.md`、`references/workflow.md` 和 `llmlint.config.example.ts` 当时仍是旧口径，随迁移同步。
- 迁移顺手修复 llmlint 的 `.ts` extension import 与 reporter 数组索引 strict undefined 类型问题，避免把新设计建立在已知 typecheck 债上。

## Implementation Acceptance Checklist

- 默认无 config 时加载 builtin ruleset，行为不低于旧 preset。
- `rulesets` 按配置顺序加载；新 id append，同 id override，并产出 diagnostics。
- 同 namespace 不同 id 可来自不同 ruleset，并在 summary 中聚合统计。
- `namespaces` 覆盖只影响 enabled / level，不修改规则定义。
- `rules` 覆盖优先级高于 namespace 和 ruleset。
- `regex` detector 支持多个 targets、标准 flags、regex literal 导入归一化。
- `llm` detector 能被 `show-llm-rules` 完整展示。
- `replace` action 支持删除、单候选替换、多候选替换；`suggest` action 支持纯提示。
- handler rule 第一版只校验 / 跳过 / warning，不执行第三方代码。
- 迁移后 `bun run typecheck` 不再因 llmlint 失败。

## User / Agent Path Acceptance

### 用户路径

1. 用户创建 `llmlint.config.ts`，只选择已安装 ruleset。
2. 运行 `bun skill/bin/llmlint.ts check <file>`，能看到 static regex issue、规则来源、namespace、level 和替换建议。
3. 运行 LLM 规则展示命令，能理解哪些规则需要 Agent 全文审查。
4. 关闭某 namespace / rule、调整某条 rule level 后，CLI 输出符合配置。
5. 启用多个 ruleset 遇到同 id 覆盖时，能看到明确 warning（哪个 ruleset 覆盖了哪条 rule）。
6. 中文 namespace alias 或稳定英文 key 配置结果一致且可解释。
7. 维护者重建官方默认 ruleset 时，生成报告说明转换了多少 `text` / `simple` / `regex`，跳过了哪些失败规则。

### Agent 路径

1. Agent 读取 `SKILL.md` 后按新 ruleset 配置说明执行，不再推荐 `presets/customRules`。
2. workflow 文档明确区分 CLI 候选定位、LLM 语义审查、用户审批式修复。
3. `show-llm-rules` 能把 `llm` detector 规则转化为本轮审查清单。
4. 修复计划里引用 rule id、namespace、ruleset source，方便用户追踪来源。
5. 遇到 diagnostics 时向用户解释：覆盖是正常机制，warning 是提醒来源变化，不等同执行失败。
6. Agent 文档、workflow、Task 01 walkthrough 中的命令和配置示例全部同步到新口径。

## Open Questions

- 覆盖提醒第一版落在 CLI stylish 的“规则加载提示”和 JSON report 的 `diagnostics` 字段；暂不新增 `llmlint rules explain`。
- namespace alias/normalization 第一版内置常见中文组名映射，后续可继续从用户 ruleset 扩展。

## Implementation Log

> 说明：以下每轮验证原含大量 neuro-book 资产同步命令与集成测试，已精简为 llmlint 自身的 `typecheck` / `bun test` / 真实章节结果。

### 2026-06-29 Rule Registry 实现

- `src/types.ts` 改为 flat `LintRuleRecord` / `DeclarativeRuleRecord` / `HandlerRuleRecord`。
- `src/config.ts` 改为 `rulesets`、`trustedRulesets`、`rulesetOverrides`、`namespaces`、`rules`。
- `src/rules.ts` 实现 ruleset loader、namespace alias、同 id override diagnostics、三层覆盖优先级和 registry summary。
- `src/scanner.ts` 改为扫描 `regex` detector，支持多个 targets 和 detector flags。
- `src/reporter.ts` 在 stylish / JSON 中输出 ruleset、namespace、registry summary 和 diagnostics。
- `旧中文规则样本目录` 仅作内置默认规则集的策展素材；`curated-import` 作为内部模块重建官方默认 ruleset，不作为用户 CLI 能力。
- 默认规则迁移到 `rulesets/builtin/default/`，删除旧 `presets/anti-ai-slop/*.json`。

计划出入：handler 第一版做校验和 warning 但不进入 active registry、不执行第三方代码；硬切为只保留官方默认规则集策展生成，不提供旧格式兼容入口；`category-suggestions.json` 收敛进 rule `note` / `action` / `examples`。

验证：`bun run typecheck` + llmlint 单测通过；CLI `check` / `show-llm-rules`（8 条 LLM detector 规则）通过。

### 2026-06-29 中文规则样本策展合并

- 新增 `src/curated-import.ts`（内部）读取中文规则样本 + 人工基础规则，生成官方默认 ruleset `builtin/default`，默认只启用它。
- `builtin/default` 合并原人工 anti-ai-slop 规则与中文策展规则，默认包含并启用 R18 / 成人词汇规则；用户可 `namespaces: {"vocabulary.r18": "off"}` 关闭。
- 重复规则按 namespace + canonical regex targets + flags 去重；同 target 不同 replacements 合并为候选并集。
- 中文 rule id 改用显式英文语义 slug `cn.<namespace>.<semantic-slug>`（如 `cn.vocabulary.body.skull-head`），不暴露 hash。
- 正式 schema 不记录旧格式来源结构；`source.canonicalKey` 记录内部 canonical detector key 供去重追踪。
- `src/namespaces.ts` 统一维护中文组名 alias（生成器与运行时共享）；`src/base-rules.ts` 存人工基础规则；`src/curated-slugs.ts` 存中文 canonical key → 语义 slug 映射，缺失则生成失败。

生成结果：源文件 11、处理 target 533、去重后 292 rule id（27 人工 + 265 中文策展），`builtin/default` 292 rules / 263 active。

计划出入：曾短暂实现 `cn-light/standard/strong/extreme` 四档，按“取精华合并成一个”收敛为单一 `builtin/cn`，随后再与 `builtin/anti-ai-slop` 合并为单一 `builtin/default`，不保留旧公开入口。高风险组名（`[可选]`/`[选开]`/`冲突`）与 `极其杀手.json` 来源默认 disabled；`vocabulary.r18` 按本轮决策强制启用。

验证：typecheck + 单测通过（含默认 ruleset、语义 slug、缺失 slug 失败、LLM rules 输出断言）；CLI 默认加载 `builtin/default` 并命中中文规则。

### 2026-06-29 去除旧格式兼容字段硬切

- 正式 rule schema 删除旧格式来源数组，`rules.json` 不再携带旧文件/组名/mode/原始 target/原始 enabled。
- 删除公开单文件导入模块和 CLI 入口；`curated-import` 内部命名改为 source / curated 语义，生成的规则看起来是 llmlint 原生规则。
- loader 遇到已移除的旧格式来源字段会报错，避免旧结构重新进入规则文件。
- 公开 CLI 收口为 `check` 与 `show-llm-rules`（后续扩展为 `check <files...>`、`fix <files...>`、`show-llm-rules`）。

验证目标：`rulesets/builtin/default` 不含旧格式来源字段；内部生成仍产 292 条并保留转换/跳过/合并报告；用户配置仍只面向 `rulesets`/`namespaces`/`rules`。

### 2026-06-29 硬切审查与遗漏修复

- 删除公开 `import-legacy` / `legacy-import` 残留入口；CLI 帮助只保留 `check` 与 `show-llm-rules`（后续扩展为多文件 `check`、`fix`）。
- 复查内置 ruleset：只保留 `rulesets/builtin/default/`，旧 `builtin/anti-ai-slop` 与 `builtin/cn` 只在清理代码/测试/历史 walkthrough 中出现。
- 修复 `llmlint.test.ts` 中非法 source schema 测试的类型绕过：正常 fixture 用 `LintRuleRecord`，非法 JSON fixture 用 `writeRawRuleset()` 写入。

验证：typecheck + 单测通过；CLI `--help` 无旧导入命令；`show-llm-rules --format json` 默认 registry `builtin/default`，292 / 263。

### 2026-06-29 CLI 输出格式优化

问题：stylish 只截前后 20 字符、`^^` 指示线在中文双宽字符下对齐不可靠、长文命中多缺 CLI 级过滤。

- `src/scanner.ts` issue context 改为完整命中行三段式 `before` / `current` / `after`。
- `src/reporter.ts` stylish 改为 high / medium / low 分段再按 rule 分组；命中用 `<mark>...</mark>` 标注，去掉 caret。
- `check` 新增 `--min-level high|medium|low`（默认 `low`）；过滤时 stylish 和 JSON 都记录隐藏数量。JSON check report 新增可选 `filter`。

修复方式统计：`builtin/default` regex 静态规则 284 条，`replace` 269（删除 126 + 替换候选 143），`suggest` 15；第一版仍不自动修复（由 Agent 上下文 + 审批执行）。

验证：单测覆盖 severity 分段、完整行 `<mark>`、`--min-level`；真实小说章节 `--min-level medium` 输出 343 条 medium（隐藏 6 low），`--min-level high` 0 条 high（隐藏 349）。

计划出入：真实章节显示默认规则在中文小说上 medium 候选偏多（破折号、比喻、泛词类），需后续规则质量与误伤治理。

### 2026-06-29 CLI 紧凑输出模式

- `Issue` 增加 `endLine` / `endColumn`（JSON 保留完整 context + 结束位置）。
- stylish 默认改为紧凑模式 `line:start-end  match: 命中文本`，不打印完整原文行（长文同行多命中会反复打印原文行）。
- `check` 新增 `--show-lines` 显式开启完整行 `<mark>`（只影响 stylish），可与 `--min-level` 组合。

后续修正：`endColumn` 对 surrogate pair 多算 1（`😀` 输出 `1:1-2`）→ 修 scanner 结束位置按 code point 闭区间列；加 emoji / emoji+普通字符 / 跨行命中单测。边界：`😀`→`1:1-1:1`、`😀A`→`1:3-1:4`、`甲\n乙`→`2:1-3:1`。

### 2026-06-29 Review / Fixability 维度与默认降噪

问题：默认 `check` 把标点/比喻/泛词等 regex 命中一并刷给 Agent（真实章节默认 349 条 medium，噪声过高）；`level` 同时承担严重度、是否喂 LLM、退出码三件事。

决策：
- `level` 保持 3 档只表严重度。
- 新增独立维度 `review`（agent / human / none）决定命中默认进入哪个审查出口；用 `agent` 而非 `llm`，避免与 `detector.type === "llm"` 撞名。
- 新增独立维度 `fixability`（auto / candidate / manual）描述机械修复能力（本轮只展示）。
- curation 主交付是命名空间策略表 `DEFAULT_NAMESPACE_POLICY`（`src/namespaces.ts`），review/fixability 在 loader 加载时解析，不重生成 `rules.json`。

已完成：
- `src/types.ts`：新增 `Review` / `Fixability` / `RuleOverrideObject`；`RuleOverride` 扩成「字符串简写 | 对象形态」；`BaseLintRuleRecord` 加可选 `review` / `fixability`，`ActiveRuleRecord` 加解析后必有的两维；`CheckJsonReport.filter` 改为必有 `{review, hiddenByReview, minLevel, hiddenByLevel}`。
- `src/namespaces.ts`：`DEFAULT_NAMESPACE_POLICY` 把 `punctuation.dedup` 降 review:none/fixability:auto，把 `punctuation.dash*`、`proliferation.mixed`、`metaphor*`、`modifier*`、`absolute`、`abstraction.hollow`、`paragraph.*`、`rhythm`、`numeral.three` 降 review:human。
- `src/rules.ts`：loader 解析 review/fixability，优先级 `用户config规则 > 用户config命名空间 > 规则自带字段 > 命名空间策略表 > detector/action 推导`。
- `src/config.ts`：`namespaces` / `rules` 覆盖同时接受字符串和 `{level,review,fixability}` 对象，并校验非法值。
- `src/reporter.ts`：来源行展示 `级别/审查/修复`；新增 review 过滤表头与 review/level 双桶隐藏统计。
- `src/cli.ts`：`check` 新增 `--review agent|human|none|all`（默认 `agent`）；两段过滤（先受众后级别）各自独立统计。
- 文档同步，明确 `detector:llm`（检测手段）与 `review:agent`（审查受众）是互补的两个 Agent 审查面。

验证：typecheck + 27 用例通过；真实章节默认 `--review agent` 61 条（隐藏 288）、`--review all` 349、`--review human` 288、`--review none` 0。

### 2026-06-30 Override 语义统一（修审查发现 #1/#2/#3/#4）

问题（high-effort review）：#1 对象覆盖无法启用默认禁用的规则（与字符串 `"medium"` 不对称，静默丢规则）；#2 对象覆盖会复活被 `rulesetOverrides off` 关掉的规则；#3 默认 `--review agent` 把 human/none 桶的 high 命中排除在退出码外；#4 隐藏数量在表头与总结行重复打印。根因：override 有「字符串/对象」两形态，`applyOverride` 与 `isExplicitlyEnabled` 两处各自解释、判断不一致。

决策：对象覆盖暴露显式 `enabled?: boolean`，字符串成为其语法糖（off→{enabled:false}、warn/error/level→{enabled:true,level:X}）；退出码跟随可见视图（只加注释与文档）。

已完成：
- `src/types.ts`：新增内部归一形态 `NormalizedRuleOverride`；`RuleOverrideObject` 加 `enabled?`；`NormalizedLlmlintConfig.namespaces/rules` 改为 `Record<string, NormalizedRuleOverride>`，loader 输入契约变为「已归一」。
- `src/config.ts`：`normalizeOverrideValue` 把字符串与对象都归一为单一 patch（唯一去糖点 `expandStringOverride`）。
- `src/rules.ts`：`applyOverride` 改为无分支字段 patch；`isExplicitlyEnabled` 只看 patch 的 `enabled`；删除 `normalizeLevel`。两个解释器合一。
- `src/reporter.ts`：总结行不再重复隐藏统计。`src/cli.ts`：退出码处加注释。文档补 `enabled`、字符串=语法糖、退出码过滤说明。

设计约束（防再犯）：override 现在只有 config 一处去糖、一个归一形态，消费端无分支 patch，结构上杜绝「两处解释器跑偏」。

验证：typecheck 通过（3 处直传 loadRules 字符串的测试改归一对象）；35 单测通过（含「对象 enabled 启用默认禁用规则」「纯属性对象不复活 off ruleset / 显式 enabled 才复活」「config 字符串语法糖仍启用」）；真实 CLI + config e2e 验证 #1/#2/#4。

### 2026-06-30 Rules 目录硬切自动加载

问题：`builtin/default/rules.json` 膨胀到约 18 万字符，人工/中文/R18 规则混在一个大 JSON 中难维护；`ruleFiles` 清单会制造新维护清单，旧根 `rules.json` 回退带来双入口风险。

决策：不拆公开 ruleset（`builtin/default` 仍唯一默认入口，含 R18）；硬切不保留 `ruleFiles` / `rulesRoot` / 旧根 `rules.json`；每个 ruleset 固定从根目录下 `rules/` 递归扫描所有 `.json`，按相对路径字典序加载；目录层级只服务人工维护，唯一语义来源仍是 rule record 的 `namespace`。内置规则按 namespace 生成层级文件（单段 → `rules/<namespace>/index.json`，点号 → `rules/<a>/<b>.json`，如 `rules/absolute/index.json`、`rules/vocabulary/r18.json`）。

已完成：
- `src/types.ts`：`RulesetManifest` 删除 `ruleFiles`。
- `src/rules.ts`：loader 拒绝 `ruleFiles` / `rulesRoot` / 根 `rules.json`，要求 `rules/` 存在且至少一个 `.json`；错误带 ruleset 相对路径与数组索引。
- `src/curated-import.ts`：生成前删旧 `rules.json` 并清空 `rules/`，按 namespace 输出层级文件，`ruleset.json` 只保留元信息与 `namespaceAliases`。
- `rulesets/builtin/default/` 重建为层级 `rules/` 目录；仍 292 / 263，其中 `rules/vocabulary/r18.json` 20 条 R18。

验证：单测 2 files / 38 通过（递归加载、目录不参与 namespace 语义、旧 `ruleFiles`/`rulesRoot`/根 `rules.json` 拒绝、curated import 层级结构）；结构审计无旧入口、47 规则文件、重复 id 0；typecheck 通过。

计划出入：改为零清单递归扫描；不保留旧 `rules.json` 回退；R18 只拆到 `rules/vocabulary/r18.json`，仍用 `namespaces` 控制。

### 2026-06-30 Rules 目录硬切审查修复

- `src/rules.ts`：校验 `rules/` 必须是目录（否则底层 `ENOTDIR` 不清晰）；JSON 语法错误报告 `规则包 <id> 的 <relative-rule-file> 不是合法 JSON`。
- 新增 `rules` 为文件、规则 JSON 语法损坏两个负向用例。
- Task 01 walkthrough 当前状态与产物清单改为 `rules/` 层级目录口径。

验证：单测 2 files / 39 通过；`check --format json` registry 无 diagnostics。

### 2026-06-30 v1 规则内容建设：取三同类项目精华

需求：让规则内容成体系、默认即最佳实践，从三个同类项目取精华。v1 原则：规则越多越细越好、容忍误杀、尽量 static。

决策（用户确认）：三项目 = shuorenhua（主矿，中文原生）/ avoid-ai-writing（44 类 taxonomy + 通用机械规则）/ humanizer（Wikipedia 概念清单）；保留并扩充现有 292 条，合并进 `builtin/default`；手写规则进 `base-rules`，`curated-import` 仍是唯一源头，绝不手改生成产物 `rules/`。

已完成：
- `src/base-rules.ts` 改为聚合器：原 27 条为 `CORE_BASE_RULES`，新规则按主题拆到 `src/base-rules/`（openers/inflation/transitions/attribution/assistant/jargon/translationese/tier2），共 34 条新 static 规则。
- 主来源 shuorenhua/phrases-zh.md 按 severity Tier 映射：Tier1 → agent 桶（medium），Tier2/3 密度类 → human 桶（low）；误杀防护 11 条写进 `note`；Tier3 单字常用词（重要/关键/核心）故意不收。
- 新增 agent 桶命名空间 `opening.cliche` / `inflation.significance` / `transition.summary` / `attribution.vague` / `cliche.uplift` / `sycophantic`；human 桶 `jargon.engineer` / `jargon.social` / `translationese` / `structure.fragment`。
- `src/namespaces.ts` 给新命名空间定策略与中文 alias；重生成 `builtin/default` 326 / 297（+34）。测试计数与断言更新。

验证：typecheck + 39 单测通过；样例文本（值得一提的是/前所未有/综上所述/赋能/研究表明/让我们拭目以待）8 条新规则全部命中；真实小说默认 `--review agent` 仍 61（新规则多为 article/chat 腔，在干净小说里休眠），`--review all` 349→352，registry 57 namespaces。

计划出入：新规则面向 AI 文章/聊天腔，面向小说时休眠、不增噪；规模约 34 条（shuorenhua Tier1 主体 + 关键 Tier2），Tier3 密度类与英文字面 regex 不搬。

### 2026-06-30 审查后补充：机械痕迹包 + 覆盖扩充

审查发现：①规则数 34 低于计划 50–80；②avoid-ai-writing 的通用机械检测器（语言无关）没挖。另修 3 处 target 重叠双命中（众所周知/不可否认/闭环）。

- 新增 `src/base-rules/mechanical.ts`（移植自 avoid-ai-writing，语言无关高精度）：`mechanical.zero-width`（零宽字符，review:none/auto 直接删）、`mechanical.homoglyph`（西里尔/希腊同形字，human）、`mechanical.placeholder`（未填充占位符 `{{}}`/`[姓名]`/`（此处…）`，agent）、`mechanical.chatbot-artifact`（`:contentReference`/`oaicite`/Bing 角标/chatgpt utm 泄漏，agent）。
- 扩充 shuorenhua 覆盖（sycophantic/inflation/openers/jargon/translationese/attribution）。
- 共 +14 条，累计 48；`builtin/default` 重生成为 **340 rules / 311 active**；`namespaces.ts` 加 `mechanical.zero-width`(none/auto) 与 `mechanical.homoglyph`(human)。

验证：typecheck + 39 单测通过；机械规则实测命中 ZWSP、`[姓名]`/`[XX]` 占位符、`:contentReference[oaicite:0]{index=0}`；真实小说默认 `--review agent` 仍 61，registry 340/311/61 namespaces。

### 2026-06-30 GitHub 发布骨架收口

需求：把 llmlint 准备为独立可发布形态（Bun CLI + Agent Skill）。

决策：第一版不做 npm/Homebrew/Docker/编辑器扩展；当时许可证为 PolyForm Noncommercial 1.0.0（2026-07-10 起由 Task 20 迁移为 `AGPL-3.0-only`）；版本源 `package.json.version`，`SKILL.md metadata.version` 与 `src/version.ts` 同步为 `2.0.0`。

已完成：初始化独立工作副本，保留 `SKILL.md`/`references/`/`rulesets/`/`src/`/`bin/`/`llmlint.config.example.ts`；新增 `README.md`/`CHANGELOG.md`/`CONTRIBUTING.md`/`AGENTS.md`/`LICENSE`/`tsconfig.json`/`tests/llmlint.test.ts`/`.gitignore`/`.gitattributes`/`bun.lock`；默认规则资产对齐 61 规则文件 / 340 / 311。

验证：`bun install` 通过，`bun test` 9 通过，`bun run typecheck` 通过，`bun run verify` 通过，`--version` 输出 `2.0.0`；CLI `show-llm-rules --format json` 340 / 311，`check README.md --format json` 340 / 311 且正常返回 issues。

计划出入：未创建 GitHub remote / commit / tag（本轮只收口本地骨架）；首次 `bun install` 曾 120 秒超时，重试后通过并生成 `bun.lock`。

### 2026-06-30 CLI 能力扩展：--fix(auto) + 多文件/目录 + Markdown 感知

需求：把 CLI 从「单文件提示器」做成「稿件级工具」，补三块短板（代码块/链接误杀、`--fix` 名存实亡、不支持多文件）。三个独立测试切片：

- **Markdown 区域遮罩**（新增 `src/markdown-mask.ts`）：纯函数 `computeMaskedRanges` 标出 frontmatter / 围栏代码块 / 行内代码 / 链接图片 / 裸 URL 区间；`scanText` 新增 `maskedRanges` 选项跳过落入其中的命中，不动 `Issue` 类型与定位。`.md`/`.markdown` 默认开，`--scan-all` 关。
- **多文件 / 目录**（`src/cli.ts`）：`check` 与 `fix` 参数改 variadic `<files...>`；目录递归收集 `.md/.markdown/.txt`。单文件 JSON 形态不变（`kind:check`），多文件用 `kind:check-multi`（顶层 registry/diagnostics/filter 全局 + `files[]` + 聚合 `summary`）；退出码跨文件取或。
- **`fix` 命令**（auto 桶）：`fix <files...>` 只应用 `fixability:auto` 规则（当前 `mechanical.zero-width` + `punctuation.dedup`）；用原生 `String.replace` 支持 `$1` 反向引用与 lookbehind；按 masked ranges 分段应用，不改代码块/frontmatter；默认 dry-run（有待修退出 1，可做 CI 门禁）、`--write` 落盘。candidate/manual 仍交 Agent + 审批写 `polish-output.md`。

变更文件：新增 `src/markdown-mask.ts`；改 `src/scanner.ts`（masked 跳过 + `ensureGlobalFlags`）、`src/cli.ts`（多文件 + fix + `expandInputs`/`resolveMaskedRanges`/`applyAutoFix`）、`src/reporter.ts`（多文件聚合 + fix 报告 + `revealInvisible`）、`src/types.ts`（`MaskedRange`/`CheckFilterInfo`/`CheckMultiJsonReport`/`Fix*`）；文档 + 测试 +11。

验证：单测 2 files / 50 passed（llmlint 34→45）；typecheck 0 错误；真实样本 `.md` 默认跳过代码块内 `其实` 与 `[note](url)`，`fix` dry-run 退出 1 不改文件、`--write` 删零宽 + `？？？→？` 退出 0 且代码块内 `？？？` 完整保留。

计划出入：原计划 glob 用 `Bun.Glob`，实测仓库未装 bun-types，改为 `node:fs` 目录递归 + 显式多文件（不留类型债，代价是暂不支持裸 `*.md` glob，下一轮解决）。

### 2026-06-30 CLI 体验打磨：tinyglobby glob + picocolors 彩色 + 依赖自包含

需求：继续打磨 CLI 输入/输出并确定依赖模型。用户三条决定：依赖写进 `package.json` 并在 skill 目录 `bun install`（自包含）；优先用已有轻库；glob 用 tinyglobby（非 ripgrep）。

- **依赖自包含**：`package.json` 增 `tinyglobby`/`picocolors`；skill 目录 `bun install` 生成本地 `node_modules` + `bun.lock`；`.gitignore` 忽略 `node_modules`。
- **glob 输入**（`src/cli.ts` `expandInputs`）：改 tinyglobby `globSync` —— 字面文件保留「不存在」语义；目录以自身为 cwd 递归 glob（避免绝对路径跨盘符在 tinyglobby 下不匹配）；glob 模式（含 `* ? { } [ ] !`）相对 cwd 直通，支持 `**`/`!` 排除/花括号。`fix` 复用同一展开。
- **彩色输出**（`src/reporter.ts`）：picocolors `createColors(color)`，各 formatter 加 `color` 参数；严格门控 `resolveColor = output!==json && stdout.isTTY && !NO_COLOR`。级别 high 红/medium 黄/low 暗、规则 id 青、命中黄、汇总红/绿、fix 预览红/绿、诊断红/黄；json/管道/Agent 抓取一律纯文本。

验证：skill 目录 `bun install` 5 包（commander/picocolors/tinyglobby + fdir/picomatch），`--version` 正常；单测 2 files / 53 passed（llmlint 45→48）；typecheck 0 错误；真实样本 `check 'manuscript/**/*.md'` glob 递归命中、`!drafts/**` 排除生效、不存在路径报「不存在」；管道 / `--format json` 输出 0 个 ANSI 字节。

计划出入：glob 从上一轮 `node:fs` 目录递归升级为 tinyglobby，获得真 glob 模式；ripgrep 经评估不采用（外部二进制、依赖 PATH，与「JS 依赖装 skill 目录」模型不符）。

### 2026-07-01 文档/运行时收口 + 整体审查：skills CLI 安装、Node+tsx 运行时

需求：把 llmlint 当独立可发布项目收口文档与运行时，并整体审查。用户三点：README 推荐用 `skills` CLI 安装；运行时不再只强调 Bun，Node 也要能跑；SKILL 提到可手动 `npm install` 装依赖。

- **安装推荐**：README / README.en / SKILL 增「`npx skills add notnotype/llmlint`」（vercel-labs `skills` CLI，skills.sh）作为首选；Agent Skill 段补「装好后在 skill 目录跑一次 `npm install` / `bun install` / `pnpm install`」。
- **运行时澄清（关键纠错）**：实测裸 `node bin/llmlint.ts`（含 `--experimental-strip-types`）失败 —— 源码约 40 处无扩展名 TS 相对导入，Node 自带类型剥离不补 `.ts`，报 `ERR_MODULE_NOT_FOUND`。真相是 **Bun（原生）或 Node + `tsx`（`npx tsx …`）**，裸 node 不行。修正 README / README.en / SKILL / cli-usage 之前「node 直接运行」的过度声称。让裸 node 跑需给 40 处导入加 `.ts` + `allowImportingTsExtensions`，代价大收益小（tsx 即 node），不做。
- **审查修复的遗漏**：(a) cli-usage.md「fixability 预留给未来 `--fix`」与「FAQ：第一版不支持自动修复」均与已落地的 `fix` 命令矛盾 → 改为指向 `fix`；(b) `src/types.ts` Fixability 注释同样「预留未来」→ 更新为 fix 已落地；(c) `package.json` description「Bun CLI」→ 运行时中性。

验证：单测 2 files / 53 passed；typecheck 0 错误；运行时三态：Bun ✓ 原生、Node + `tsx` ✓ 全功能（check / glob / fix / json）、裸 node ✗。

### 2026-07-01 独立开发仓硬切

本轮把真相源正式切到独立开发仓（仓库根 = 开发工作区，`skill/` = 可安装包，`evals/` 进 git）。详见 [Task 04 llmlint Standalone Development Repository](../04-llmlint-standalone-repo/README.md)。

计划出入：旧中文规则样本 scratch 目录已不存在，独立仓测试改用最小 fixture 覆盖 curated import 行为；runtime 依赖由 package 声明并在 `skill/` 目录自包含，不再随任何外部 user-assets 同步。

## References

- 可安装 skill package：`skill/`
- 稳定 CLI 参考：`skill/references/cli-usage.md`、`skill/references/patterns.md`、`skill/references/workflow.md`
- llmlint 历史源头：[Task 01 anti-ai-slop / llmlint skill](../01-anti-ai-slop-skill/README.md)
- 评测体系（本任务下游消费者）：[Task 03 llmlint Eval Harness](../03-llmlint-eval-harness/README.md)
- 独立仓由来：[Task 04 llmlint Standalone Development Repository](../04-llmlint-standalone-repo/README.md)

## 2026-07-11 第一版报告驱动的规则精简

用户用 `evals/report/report.json` 与典型 AI 小说正文复核后指出：页面把大量规则显示为“可自动替换”，批量替换完成后反而没有候选可交给 LLM。

诊断确认规则数据本身有 303 条 regex：3 auto / 253 candidate / 47 manual；真正错误是工作台把 `candidate` 与 `auto` 合并进一键静态修复。典型正文原始 116 命中、29 个 agent 候选；旧口径批量应用 81 处后 agent 候选归零。

本轮收紧三个边界：

- `auto` 只表示无需上下文判断的机械清理；`candidate` 只提供替换草案，允许用户逐条或按主动选中的规则应用，绝不进入一键机械修复。
- `report.json` 作为创作 task profile 的选择证据：LLM 修复清单排除 `noise/anti`，保留 strong/weak、insufficient 与未测规则；不物理删除规则超集。
- 新增规则级默认策略，报告中的 4 条 strong 规则覆盖粗粒度 human namespace 路由进入 agent 桶：`subject-measure-word`、`repeated-de-pairs`、`absolute-claim-modifier`、`optional-mood-modifiers`。

典型正文新口径：机械修复 0 处，agent 候选 29 处，其中 task profile 保留 23 处（5 strong / 17 weak / 1 未测），不再出现“一键修复后 LLM 无事可做”。

验证：聚焦单测 73/73；web client typecheck 与 server typecheck 通过。根 `bun run typecheck` 仍被既有 `evals-generator/*` alias 在根 tsconfig 中不可解析的 4 个错误阻塞，本轮未触碰该既有问题。

## 2026-07-11 第二轮规则精简

首轮仍把 253 条语义 replace 规则保留为默认 candidate，产品虽然不再批量应用，规则页和单条动作仍会暗示“已有安全替换”。第二轮把权限模型进一步收紧：`deriveFixability()` 默认 manual，namespace 策略除 3 条确定性机械规则外全部 manual。最终默认分布为 303 regex：auto=3、candidate=0、manual=300；用户配置仍可显式提升指定 regex replace 为 candidate。

同时新增构建期 `creative-writing@1` profile，不删除规则资产，只从创作候选中排除 noise/anti 与 8 条稳定重叠规则。四个首轮收敛家族为程度副词、空泛量词、句尾比喻、二元转折；`sudden-moment` 收窄为只匹配“突然间/忽然间”。每条抑制记录 canonical rule、原因与说明，规则页可解释为什么未进入 profile。

指定 `index2.md` 验收从首轮 23 个候选进一步收敛到 17 个：机械修复仍为 0，候选重复 span 为 0。与首轮计划的出入是撤销“strong 规则提升默认 candidate”的方向：verdict 只控制 profile 选择，不再影响直接应用权限。

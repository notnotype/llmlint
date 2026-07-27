# 规则数据模型（当前契约）

本文件是规则数据形态的**活契约**：写规则、加 detector、加 handler、改 loader 之前先读这里。类型定义在 `src/types.ts`，加载与校验在 `src/rules.ts`。

设计沿革与当初的权衡记录在 `docs/tasks/23-skill-loop-and-service/rule-model-v3-design.md`（历史文档，不随实现更新）。两者冲突时**以本文件和源码为准**。

规模数字（多少条 active、各桶分布）不写在这里，看 `PROJECT-STATUS.md`——那些会漂移。

## 0. 一句话结构

规则是**纯 JSON 数据**，只有算法体在代码里。整条链是：

```
磁盘 JSON → loader 补全 + 校验 → Active 记录 → 三种 detector 执行器 → Issue / DensityIssue → 报告投影
```

## 1. 磁盘形态：两个分支

规则文件在 `rulesets/<ruleset>/rules/**/*.json`，每个文件是一个规则对象数组。顶层联合只有两支：

```ts
type LintRuleRecord = DeclarativeRuleRecord | HandlerRuleRecord;
```

共享基座 `BaseLintRuleRecord`：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✓ | 全局唯一标识，**跨版本稳定**。被测试、eval 报告基线和用户 config 引用，改名成本极高。 |
| `namespace` | ✓ | 批量覆盖单位，也是 `DEFAULT_NAMESPACE_POLICY` 的键。 |
| `title` | ✓ | **用户可见标签，必须全局唯一**（见 §9 守卫）。紧凑 JSON 里 Agent 只看得到它。 |
| `level` | ✓ | `high` / `medium` / `low`。严重度 + 退出码口径。 |
| `review` | — | `agent` / `human` / `none`。审查受众，缺省由 loader 推导。 |
| `fixability` | — | `auto` / `candidate` / `manual`。机械修复能力，缺省由 loader 推导且受能力约束。 |
| `enabled` | — | 缺省视为启用。 |
| `note` | — | 处理边界说明。**只写用户/Agent 需要知道的边界**，实现理由写代码注释。 |
| `examples` | — | `{text, hit, fix?, reason?}[]`，供 `rules` / `guide` 与规则作者参考。`hit` 必填。 |
| `source` | — | `{version?, canonicalKey?, importedFrom?}`。`canonicalKey` 用于消重审计。 |
| `scope` | — | 扫描域，缺省全文全域。见 §3。 |
| `ruleset` | — | **由 loader 写入**，规则文件里省略。 |

三个维度是**正交**的，不要混：`level` 是「多严重」，`review` 是「给谁看」，`fixability` 是「能不能机械改」。

两处容易误用：

- **`review` 是审查期维度，不能当写作期的取舍依据。** `human` 表示「置信度不足，别让 Agent 自动改」；写作期多提一句约束并不损坏既有正文，代价结构不同。实测判别力最强的几条规则恰好都在 `human` 桶，照 `review: agent` 过滤会把证据最强的滤掉。写作期的取舍见 §8b。
- **`fixability` 不是「改法要多少判断」。** 因为 I13 强制语义替换默认 `manual`，当前 266 条 active 里 264 条都是 `manual`，这个字段在选规则时零区分度。它量的是「脚本能不能盲改」。

`examples` 必须同时能表达命中例与对照例（`hit: false` = 形近但不该报）。只给反例会让消费方——尤其是写作期提示词——把形近的正当写法也一并躲开，写出过度躲闪的干瘪文本。早期形态 `{bad, good?}` 把 `good` 同时用作「改写后的版本」和「保留」这种裁决词，同一字段两种含义，消费方无法可靠区分正反例；曾导致 `guide` 把 8 个对照例全标成「别写成」、web 把对照例画成红色删除线。

### 分支 A：声明式规则

数据完全自足，无需代码配合。

```ts
DeclarativeRuleRecord = Base & {
    detector: RegexDetector | LLMDetector | DensityDetector;
    action:
        | {type: "replace"; replacements: string[]}
        | {type: "suggest"; message: string};
}
```

### 分支 B：handler 规则

声明式模型表达不了的状态机 / 统计逻辑。规则 JSON 仍是数据，只有算法在代码里。

```ts
HandlerRuleRecord = Base & {
    handler: {type: "builtin"; name: string};   // name 是编译期注册表键
    action: {type: "suggest"; message: string}; // 恒 suggest，无机械修复
}
```

`name` 必须是 `src/handler-rules/index.ts` 的 `HANDLER_REGISTRY` 里已注册的键。未注册的名字会被 loader **跳过 + 诊断**（`unknown-handler-name`）。这一条同时承担两件事：老版本 skill 装新版规则包时优雅降级，以及**天然拒绝第三方规则包携带外部算法引用**。

当前已注册的 handler：

| name | 粒度 | 判断什么 |
| --- | --- | --- |
| `not-is-comparison` | 逐处 | 「不是 A，(而)是 B」对比句式状态机，带确认语 / either-or / 反问尾巴排除 |
| `period-stutter` | 逐处 | 碎句号：连续极短句堆叠 |
| `overcompressed-prose` | 全文一条 | 过度精炼：短叙述段过密且自然连接偏少，读起来像分镜表 |
| `low-connective-density` | 全文一条 | 引号外叙述的功能词与白话连接同时偏低 |
| `quote-emphasis` | 全文一条 | 叙述层 1–4 字短词被成对引号强调 |
| `long-paragraph` | 逐段 | 叙述层单段可见字数超阈值，字数写进 `Issue.detail` |

全文一条 / 逐段类 handler 要注意 `length` 取短锚定，见 §6。

## 2. 三种 detector

四个判据类别命名的是**判据的性质**，不是执行者：词法（regex）/ 统计（density）/ 算法（handler）/ 语义（semantic）。语义类早期叫 `llm`，那是按执行者命名，既和 `review: "agent"`（给谁看）撞语义，也和「写作期全部规则都由模型消费」这个事实冲突。

```ts
RegexDetector = {type: "regex"; targets: string[]; flags?: string}

SemanticDetector = {type: "semantic"; prompt: string}   // 不静态扫描，只能读上下文判断

DensityDetector = {
    type: "density";
    patterns: {target: string; flags?: string; bucket?: string; core?: boolean}[];
    minHits: number;         // 绝对次数门槛
    perKilo?: number;        // 每千可见字门槛
    coreMinHits?: number;    // 核心桶命中门槛
    minBuckets?: number;     // 至少命中的不同桶数（多样性）
    minChars?: number;       // 文本太短不评密度
    granularity?: "doc" | "paragraph";   // 缺省 doc
}
```

density 的多个门槛是 **AND 语义**——全部满足才产出一条。计数与分母都跳过遮罩区、豁免区和结构行。

### density 与 handler 的分界（重要）

density 表达的是**分布指纹**（「套词 12 处/千字才算模板腔」）。它的 `hits` / `perKilo` / `samples` 只在 pattern 是**具体词组**时才有意义。

**逐字计数类的统计量不属于 density。** 反例：`story-deslop.long-paragraph` 曾用 `patterns: [{target: "[\\p{L}\\p{N}]"}] + minHits: 200 + granularity: paragraph` 当段落长度计，结果 `hits` = 段落字数、`perKilo` **恒等于 1000**（零信息量）、`samples` 退化成段落头 8 个单字。按 density 口径汇报就是废话。这类规则已改为 handler，字数走 `Issue.detail`。

判据：**pattern 命中数与文本长度成正比 ⇒ 不是密度，是长度，用 handler。**

## 3. `scope`：扫描域

```ts
ScanScope = {
    layer?: "narrative" | "dialogue" | "all";              // 缺省 all
    position?: {kind: "opening" | "ending"; chars: number}; // 缺省不限位置
}
```

`narrative` / `dialogue` 是**等长派生视图**：成对引号段（含引号）被替换成同样长度的 `。` 串，换行原样保留，所以 `match.index` 与原文偏移完全一致，命中可以直接回定位。

代价与约束：

- **narrative 层的规则不得依赖「数句号」类判断**——引号段在那层就是一串 `。`。
- **不变量**：声明了非全域 `scope` 的规则，`fixability` 被强制降级为 `manual`（`rules.ts` 诊断码 `scoped-rule-not-auto-fixable`）。机械修复拿命中区间改原文，占位视图上的命中会写坏原文；`position` 窗口同理不留口。

## 4. loader 做的三件事

### ① 补全 `review` / `fixability`

磁盘上可选，加载后必填。优先级：

```
规则自带字段  >  DEFAULT_RULE_POLICY[id]  >  DEFAULT_NAMESPACE_POLICY[namespace]  >  detector/action 推导
```

推导默认值刻意保守：`deriveReview` 一律 `"agent"`，`deriveFixability` 一律 `"manual"`。handler 规则的 `fixability` 恒为 `manual`，显式声明其它值会被忽略并报 `handler-rule-not-fixable`。

### ② 用能力约束收口 `fixability`（权限设计的核心）

```ts
if (declared !== "manual" && (detector.type !== "regex" || action.type !== "replace"))
    return "manual";
```

**`action.replace` 只是替换模板，不授予应用权限。** 只有 `regex` + `replace` 才可能进入 `auto` / `candidate`；density 与 handler 恒 `manual`。这条和 §3 的 scope 不变量是当前唯一防止「Agent 拿着替换模板去改原文」的结构性防线，改动前务必想清楚。

### ③ 出诊断而不是抛异常

未知 detector 类型、未注册 handler 名、非法 fixability 都走 `RegistryDiagnostic`：

```ts
{level: "info" | "warning" | "error"; code: string; message: string;
 ruleset?, ruleId?, namespace?, previousRuleset?, nextRuleset?}
```

单条规则被跳过，整体加载不中断。这样一份规则包里的坏规则不会让整个 CLI 失效。

## 5. 加载后的类型：从联合收窄到具体

```ts
ActiveDeclarativeRuleRecord = DeclarativeRuleRecord & {ruleset: string; review: Review; fixability: Fixability}
ActiveHandlerRuleRecord     = HandlerRuleRecord     & {ruleset: string; review: Review; fixability: Fixability}
ActiveRuleRecord            = ActiveDeclarativeRuleRecord | ActiveHandlerRuleRecord
```

再按 detector 收窄，让执行器不必二次判别：

```ts
RegexRuleRecord    = ActiveDeclarativeRuleRecord & {detector: RegexDetector}
DensityRuleRecord  = ActiveDeclarativeRuleRecord & {detector: DensityDetector}
SemanticRuleRecord = ActiveDeclarativeRuleRecord & {detector: SemanticDetector}
```

`LoadedRules` 是预分桶产物，消费端直接取对应桶：

```ts
{rules, regexRules, semanticRules, densityRules, handlerRules, diagnostics, summary}
```

handler 规则没有 `detector` 字段，所以「这条规则靠什么判据命中」不能直接读 `detector.type`；统一走 `ruleDetectorKind(rule)`（`src/rule-registry.ts`），返回 `RuleDetectorKind = "regex" | "density" | "handler" | "semantic"`。

`RuleRegistryCatalogItem = {rule, defaultEnabled}` 是给浏览器端用的：保留默认启停，让前端按用户覆盖重新生成 active registry，不必回到磁盘。

## 6. `ScanContext`：三种 detector 共享的上下文

由 `prepareScanContext` 一次算好，避免各执行器重复切行、重复配对引号。纯数据，浏览器可打包。

```ts
{
    content: string;
    layers: {all: string; narrative: string; dialogue: string};  // 等长视图，all 是原文引用
    maskedRanges: MaskedRange[];    // markdown 遮罩：代码块 / frontmatter / 链接
    ignoreRanges: MaskedRange[];    // ignoreTerms 白名单区间
    dialogueRanges: MaskedRange[];  // 成对引号区间（含引号本身），行内配对
    lines: ScanLine[];              // {start, end, text, structural}
}
```

**避坑**：`MaskedRange` 是元组 `[start, end)`，**不是** `{start, end}`。写成 `range.start` 会得到 `undefined`，`content.slice(undefined, undefined)` 返回整篇而不报错。

`ScanLine.structural` 标记 markdown 结构行（标题/列表/引用/表格/分隔线）与章节标题行，density 与 handler 的统计默认跳过——否则一个 bullet 列表就能把密度顶爆。

handler 契约极窄：

```ts
type RuleHandler = (ctx: ScanContext) => HandlerFinding[];
type HandlerFinding = {index: number; length: number; message?: string};
```

`message` 映射为 `Issue.detail`。**`length` 决定 `Issue.match` 的长度**（`match = content.slice(index, index + length)`），所以段落级 / 全文级 handler 要用短锚定，不要把整段塞进 `match`。

## 7. 命中：两种形状，刻意不合并

**逐处命中**（regex ∪ handler）：

```ts
interface Issue {
    rule: RegexRuleRecord | ActiveHandlerRuleRecord;
    line, column, endLine, endColumn: number;
    match: string;
    target: string;    // regex = 命中的 target 模式；handler = 注册表键名
    detail?: string;   // handler 的动态补充说明；regex 命中无此字段
    context: {before, current, after};   // scanner 给的是整行
}
```

**分布命中**（density 独立一支）：

```ts
type DensityIssue = {
    rule: DensityRuleRecord;
    line, column: number;   // 锚在首个命中位置
    hits: number;
    perKilo: number;
    samples: string[];      // 去重，≤8 条
}
```

分开是因为语义不同：一条 `DensityIssue` 代表全文或一段的统计结论，**不能当逐处替换指令**。合并进 `Issue` 会让消费端误以为可以逐处修。

## 8. 报告投影：第三层形态

给 Agent 消费时有一层紧凑投影（`src/check-report.ts`，纯函数、无终端依赖，CLI 与 web「复制 JSON」共用）：

```ts
CompactRuleEntry = {namespace, title, level, review, fixability, action, note?}
CompactIssue     = {ruleId, line, column, endLine, endColumn, match, detail?, context}
```

规则元数据按 id 去重提到报告顶层 `rules`，命中只引用 `ruleId`；`context` 各裁 24 码点。剔掉的是规则作者才需要的字段：`detector`（长正则）、`source.canonicalKey`、`scope`、`examples`、`ruleset`。完整形态用 `check --rule-detail`。

**这层投影决定了 `title` 的重要性**：压缩后 Agent 拿不到 `detector.targets` 和 `examples`，只剩 `title` + `note` + `action` 三个字段可读。所以标题必须逐条唯一且能独立读懂，不能是分类名。

不变量：`issues[].ruleId` 与 `densityIssues[].ruleId` **一定**能在顶层 `rules` 里查到（按构造成立——投影只从传入的命中收集规则）。

## 8b. 写作期投影：同一条规则的第四层形态

规则库有两个消费时机，事后（`check` / `fix` / `detect` 定位并修复成稿）和事前（`guide` 输出动笔前的约束）。**同一条规则两个投影，不加字段**：

| | 取什么 | 不取什么 |
| --- | --- | --- |
| 写作期（`guide`，`src/guide.ts`） | `title` + `action`（`action.message` 本来就是祈使句写法）+ `examples`（命中例与对照例都要） | `detector.prompt` |
| 审查期（`rules`，`src/reporter.ts`） | `detector.prompt` + 全部 `examples` + 三个维度 | — |

语义规则的 `detector.prompt` 是**审稿员的判定流程**（「判断文本是否…」），口气不对，不进写作期摘要。

**档位（`GuideTier`）是「哪些规则值得占提示词预算」的实现**，四档严格嵌套：

| 档 | 加进来的是 | 依据 |
| --- | --- | --- |
| `core` | 语义规则 + profile 里 `strong` 的 | 语义规则 CLI 永远抓不到，摘要是唯一执行路径；`strong` 有配对语料证据 |
| `standard` | 再加全部 `action.type === "suggest"` 的 | CLI 能定位症状但改法要重写整句，事前不写远比事后重写便宜 |
| `wide` | 再加 profile 里 `weak` 的 | — |
| `full` | 再加词表类（`action.type === "replace"`） | CLI 抓得准也能提替换词，边际价值最低，所以排最后 |

判别力（`strong` / `weak`）**不内建进 skill 包，也不写进规则记录**：verdict 只在特定 task profile 内有效（CONTEXT.md §3 / I12），把某个语料的结论烧进全局规则超集会让它看起来像规则的固有属性。它只能由 `guide --profile <report.json>` 从外部传入；没传时 `core` 只剩语义规则、`wide` 等同 `standard`，不假装有证据。

## 9. 结构性守卫（改规则时会拦你的东西）

| 守卫 | 位置 | 拦什么 |
| --- | --- | --- |
| title 全局唯一 | `tests/rule-titles.test.ts` | 标题退化成分类名（曾有 19 条都叫「R18词汇」） |
| title 无正则作者术语 | 同上 | 把「必带"的/地"防误伤」这类作者笔记当标题 |
| title ≤ 20 码点 | 同上 | 标题写成句子，吃掉紧凑 JSON 的体积收益 |
| 本文件覆盖全部 detector 与 handler | `tests/rule-model-doc.test.ts` | 新增 detector 类型或 handler 后忘记更新本文件 |
| 对照例不被写成反例 | `tests/guide.test.ts` | `hit=false` 的示例被标成「别写成」，教模型过度规避 |
| 档位严格嵌套 | 同上 | 放宽档位却丢掉窄档位里的规则 |
| `examples[].hit` 必填、对照例不带 `fix` | `rules.ts` | 正反例二义（旧 `{bad, good?}` 的老问题复发） |
| scope ⇒ 非 auto | `rules.ts` | 派生视图上的机械修复写坏原文 |
| handler 名已注册 | `rules.ts` | 第三方规则包引用外部算法 |

## 10. 配置覆盖：语法糖在入口一次去掉

```ts
RuleOverride = "off" | "warn" | "error" | RuleLevel | {enabled?, level?, review?, fixability?}
```

字符串简写在 config 归一化阶段就展开成统一 patch（`off → {enabled:false}`、`warn → {enabled:true, level:"medium"}`、`error → {enabled:true, level:"high"}`），所以**消费端没有任何分支**处理简写。

三层覆盖优先级：`rule id > namespace > ruleset > 规则默认`。

纯属性对象（只设 `review`/`fixability`/`level`，不带 `enabled`）**不算显式启用**，不会复活被关闭的 ruleset。

## 11. 加一条规则的检查清单

1. 选分支：能用 regex/density 表达就用声明式；需要状态机或跨行统计才写 handler。
2. `id` 想清楚再定——被测试和 eval 基线引用，后面基本改不动。
3. `title` 唯一且能独立读懂：替换类写「命中词→替换词」，删除类描述被删对象。别写分类名。
4. `level` 定 `high` 之前想清楚：它决定退出码，能当 CI 门禁的必须低误杀。
5. `review` 缺省是 `agent`（可修入口）。语境敏感、真人语料也会命中的规则要显式写 `human`。
6. `fixability` 不写就是 `manual`。想要 `auto` 必须是 regex + replace + 全文全域，且替换在任何上下文都成立。
7. 有 `scope.layer: "narrative"` 就别依赖数句号；有 scope 就别想要 auto。
8. 写 `examples` 时**至少配一个 `hit: false` 的对照例**：形近但正当的写法不写清楚，写作期摘要会教模型连它一起躲。
9. 跑 `bun run test`（会先重烘 registry，避免对着过期产物假绿）。

## 12. 维护要求

本文件是**活契约**，以下改动必须同步更新它：

- `src/types.ts` 里规则相关类型的字段增删或语义变化
- 新增 / 移除 detector 类型
- 新增 / 移除 `HANDLER_REGISTRY` 条目
- loader 的补全优先级、能力约束或不变量变化
- 紧凑投影（`CompactRuleEntry` / `CompactIssue`）字段变化
- 写作期投影（§8b）的取字段口径或档位定义变化
- 新增结构性守卫

`tests/rule-model-doc.test.ts` 会检查本文件是否覆盖全部 detector 类型与 handler 名——漏更新会让测试失败，不靠人记得。

# 规则模型 v3 设计：扫描域 / 密度检测器 / 具名 handler / 词级白名单

> Task 23 子设计。目标：让声明式规则模型能收下 story-deslop 的校准检测器，同时保住「规则是可共享数据」与「scanText/materializeRules 是浏览器可用纯函数」两条底线。
>
> ⚠ **本文件是设计时的提案与权衡记录，不随实现更新，已知与当前实现有出入**（例如 long-paragraph 已从 density 改为 handler）。当前规则数据模型的活契约是 [../../../skill/references/rule-model.md](../../../skill/references/rule-model.md)；两者冲突以活契约和源码为准。本文件保留是为了记录「当初为什么这样选」。

## 0. 设计底线

1. **向后兼容**：现有 340 条规则 JSON 一字不改仍按原语义运行（新字段全部 optional，缺省 = 现状）。
2. **纯函数**：所有新计算（引号遮罩、密度门槛、handler）不碰文件系统、不动态加载代码，可被 web 浏览器端打包消费。
3. **规则是数据**：能声明式表达的绝不写代码；handler 是编译进包的具名函数，不是可分发资产。
4. **一层遮罩机制走到底**：markdown 遮罩、词级白名单、位置窗口共用 `MaskedRange` 语义，scanner 只有一套跳过逻辑。

## 1. 扫描域 `scope`（叙述/对白分域 + 位置窗口）

### 类型

```ts
/** 扫描域：规则在哪一层文本、哪个位置窗口上生效。缺省 = 全文全域（向后兼容）。 */
export type ScanScope = {
    /**
     * 文本层。narrative=只扫成对引号外的叙述；dialogue=只扫成对引号内（含【】系统面板）；
     * all=全文（缺省）。
     */
    layer?: "narrative" | "dialogue" | "all";
    /** 位置窗口：只在文首/文末 chars 个可见字符内生效（如章尾预告腔只扫末 600 字）。 */
    position?: {kind: "opening" | "ending"; chars: number};
};

// BaseLintRuleRecord 增加：
scope?: ScanScope;
```

### 引号遮罩实现（关键决策）

**narrative 层不用「命中起点判定」，用等长占位视图**：把成对引号片段（含引号）替换为等长 `。` 占位，narrative 规则在这个视图上 exec。理由（照搬 story-deslop 的实战结论）：

- 等长 → `match.index` 与原文偏移一致，行列定位、excerpt 截取直接用原文，零换算。
- 占位句号天然截断 `[^。，]` 类字符类，规则**不会跨引号拼出假命中**（仅起点判定挡不住这种）——这是否定排比等跨片段模式的硬需求。

dialogue 层同理取补集视图。视图在 `prepareScanContext` 一次算好，三层共享：

```ts
export type ScanContext = {
    content: string;
    /** 三层等长视图：all 即原文引用，无拷贝。 */
    layers: {all: string; narrative: string; dialogue: string};
    maskedRanges: MaskedRange[];      // markdown 结构遮罩（既有）
    ignoreRanges: MaskedRange[];      // 词级白名单区间（§4）
    dialogueRanges: MaskedRange[];    // 成对引号区间（诊断/报告可复用）
    /** （v3.1）行切分结果：遮罩阶段已经算过，复用给 density(paragraph) 与 handler，免得逐个重算。 */
    lines: Array<{start: number; end: number; text: string; structural: boolean}>;
};
```

（v3.1）`structural` 标记 = markdown 结构行（标题/列表/引用/表格/分隔线）与章节标题行（`第N章`）。**逐处 regex 规则不吃这个标记**（标题里的套词照报）；**density 统计与 handler 的分母/计数默认跳过结构行**——否则一个 bullet 列表就能把碎句号/过度精炼顶爆。

引号配对规则：成对引号表 `「」『』【】“”‘’`；**行内配对**（配对不跨换行），未闭合引号不遮罩——防止一个漏引号把后半篇全吞进对白层。ASCII 直引号 `"` `'` 因无方向易误配，v1 不入表（记入 note，后续按语料反馈再议）。**（v3.1）配对计算必须跳过 markdown 遮罩区**：代码块 / frontmatter / 行内代码里的引号字符不参与配对，否则代码块里一个 `「` 会制造假对白区吞掉正文。

### 位置窗口实现

`computePositionWindow(ctx, kind, chars): MaskedRange`——从文首/文末按**可见字符**（CJK+字母数字，`visibleLength` 语义从 story-deslop 移植为共享工具）数满 chars，返回允许区间；命中起点落窗口外即跳过。窗口按 narrative 视图可见字数计（预告腔看的是叙述层结尾，台词不算数）。

## 2. 密度型 detector

逐处正则报不了「套词 12 处/千字才是模板腔」这类分布指纹，新增第三种 detector：

```ts
export type DensityDetector = {
    type: "density";
    /** 计数模式组；总命中 = 各 pattern 命中之和。 */
    patterns: Array<{
        target: string;
        flags?: string;
        /** 统计桶名，缺省 "default"；供 minBuckets 多样性门槛。 */
        bucket?: string;
        /** 核心桶命中（coreMinHits 统计口径），缺省 false。 */
        core?: boolean;
    }>;
    /** 绝对次数门槛：总命中低于此数不报。 */
    minHits: number;
    /** 密度门槛：每千可见字命中数（按 scope 层可见字数计），缺省不设。 */
    perKilo?: number;
    /** 核心命中数门槛，缺省不设。 */
    coreMinHits?: number;
    /** 至少命中的不同桶数，缺省不设。 */
    minBuckets?: number;
    /** 参与评估的最小可见字数：文本太短不评密度，缺省不设。 */
    minChars?: number;
    /** 统计粒度：doc=全文一条（缺省）；paragraph=逐段评估、逐段报。 */
    granularity?: "doc" | "paragraph";
};
```

产物是新 Issue 形态（全文/每段最多一条，锚在首个命中）：

```ts
export type DensityIssue = {
    rule: DensityRuleRecord;
    line: number;
    column: number;
    /** 总命中次数与每千可见字密度。 */
    hits: number;
    perKilo: number;
    /** 去重样本（≤8 条），供 Agent/人快速识别命中形态。 */
    samples: string[];
};
```

- 所有门槛必须**全部满足**才报（AND 语义，与 story-deslop 一致）。
- 计数时命中起点落 masked/ignore 区间的不计入。
- `fixability` 恒为 `manual`（分布问题没有机械修复）；loader 校验，规则声明 auto/candidate 即 diagnostic error。
- report：`CheckJsonReport` 增加 `densityIssues: DensityIssue[]`（新增字段，旧消费端无感）；`LoadedRules` 增加 `densityRules`。

覆盖 story-deslop 的：套词密度、比喻密度、解释链（core+buckets）、抽象总结、微动作复读、引号强调（dialogue 层 + doc 粒度近似）、动作清单（paragraph 粒度）、公文腔（dialogue 层【】+ paragraph 粒度）。

## 3. handler rule：具名注册表，不是 module path

types.ts 里已有的 `handler: {type:"module", path}` 形态**废弃改造**（快速开发期允许 breaking）：动态加载模块在浏览器端做不到，第三方 handler 代码本来就不该执行。改为：

```ts
export type HandlerRuleRecord = BaseLintRuleRecord & {
    handler: {
        type: "builtin";
        /** 编译进 skill 包的 handler 注册表键名。未知键 = diagnostic error，规则不激活。 */
        name: string;
    };
};

/** handler 契约：纯函数，输入扫描上下文，输出命中区间。 */
export type RuleHandler = (ctx: ScanContext) => HandlerFinding[];
export type HandlerFinding = {
    index: number;
    length: number;
    /** 覆盖规则默认 message 的补充说明（如具体计数）。 */
    message?: string;
};
```

- 注册表 `skill/src/handler-rules/index.ts` 静态导出 `Record<string, RuleHandler>`，随包编译，浏览器可打包。
- 规则 JSON 仍是数据（声明 level/review/scope/文案），只有算法体在代码里——第三方 ruleset 引用未注册的 handler 名会得到明确 diagnostic，天然拒绝外部代码。`trustedRulesets` 字段保留但 v3 仍无消费者（留给未来签名分发方案）。
- findings 出来后统一过 masked/ignore 过滤（与 regex 同一跳过逻辑）。

首批 handler（全部从 check-ai-patterns.js 移植，校准注释一并搬）：
`not-is-comparison`（状态机：确认语/either-or/合成词/跨空行排除）、`period-stutter`（连续短叙述句 run）、`overcompressed-prose`（短段占比+虚词密度）、`low-connective-density`（功能词+中长句双门槛）。复读/截断退化检测列后续批次。

## 4. 词级白名单 `ignoreTerms`

```ts
// LlmlintConfig 增加：
/** 项目级豁免词（世界观术语、绰号、章名）。命中区间与豁免词出现区间重叠即丢弃该命中。 */
ignoreTerms?: string[];
```

实现：`computeIgnoreTermRanges(content, terms)` 把每个豁免词在原文中的所有出现算成区间，**当作又一层 mask**——regex、density 计数、handler findings 走同一套重叠判定。例：白名单 `仿佛山海`（章名）→ 规则命中 `仿佛` 的区间落在 `仿佛山海` 出现区间内 → 跳过；单命中 `仿佛` 于别处照报。语义可预测、一个机制、三种 detector 全覆盖。

不引入 `.deslop-whitelist` 独立文件——配置入口已经有 `llmlint.config.ts`，不开第二个。

## 5. scanner 管线（v3 全景）

```
prepareScanContext(content, config)
  ├─ computeMaskedRanges(content)            // 既有 markdown 遮罩
  ├─ computeDialogueRanges(content)          // 新：行内成对引号
  ├─ computeIgnoreTermRanges(content, cfg)   // 新：词级白名单
  └─ 派生三层等长视图 layers

scanText(ctx, rules)
  ├─ regex 规则：在 scope.layer 视图 exec → 起点落 masked/ignore → skip
  │                                        → position 窗口外 → skip
  ├─ density 规则：同上计数 → 门槛 AND 判定 → 0..n 条 DensityIssue
  └─ handler 规则：handlerRegistry[name](ctx) → findings → masked/ignore 过滤
```

`scanText(content, rules, options)` 旧签名保留为薄包装（内部自建 ScanContext），CLI/web 逐步迁到显式 `prepareScanContext`（web 只需算一次遮罩即可多次重扫）。

## 6. story-deslop 检测器落位总表

| 检测器 | 形态 | scope | 目标 namespace |
|---|---|---|---|
| voice-contrast | regex | narrative | `cliche.voice-contrast`（新） |
| negation-parade ×2 | regex | narrative | `contrast.negative-listing`（并入既有） |
| reverse-not-is | regex（lookbehind 前字排除表） | narrative | `contrast.binary` |
| trailer-ending | regex | narrative + position:ending 600 | `ending.trailer`（新） |
| em-dash | 既有 punctuation.dash 家族已覆盖 | — | 差集核对即可 |
| long-paragraph | regex（`[^\n]{200,}`） | narrative | `paragraph.split-long` 并入 |
| not-is-comparison | handler | narrative | `contrast.binary` |
| cliche/metaphor/reasoning/abstract/micro-action 密度 | density(doc) | narrative | `cliche.*` / `metaphor` / `explanation.chain`（新）等 |
| action-list | density(paragraph) | narrative | `rhythm.action-list`（新） |
| notice-formality | density(paragraph) | dialogue | `register.notice`（新） |
| quote-emphasis | handler（v3.1 修订：narrative 视图里引号连内容一起被占位，density 模式根本看不到引号短词；且台词排除逻辑本就依赖邻接引语动词/嵌套判断） | 用 ctx 双层视图 | `emphasis-crutch` 并入 |
| period-stutter / overcompressed / low-connective | handler | narrative | `rhythm.*` |
| degeneration 工程词泄漏 | regex | all | `mechanical.stage-leak`（新） |
| degeneration 复读/截断 | handler（后续批次） | all | `mechanical.*` |

severity 映射：blocking → `level:high, review:agent`；advisory → `level:medium/low`，误杀风险高的（低连接、过度精炼、引号强调）归 `review:human` 桶。所有导入规则 `source.importedFrom: "oh-story-claudecode/story-deslop@<commit>"`（MIT，ruleset manifest 记 attribution），校准基线（《万疆》0 命中等）写进各规则 `note`。

## 7. 消费端影响

- **fix**：density/handler 恒 manual，fix 管线零改动；regex 规则的 scope 遮罩自动被 fix 尊重（同一 ScanContext）。
- **web**：registry.json 烘焙含新 detector 形态；浏览器扫描入口改用 `prepareScanContext`。属 Task 23 之外的 web 消费轮，本设计只保证纯函数可用。
- **evals**：density/handler 规则的命中是 doc 级布尔/计数，天然适配整篇判别口径；lift 口径接入随后续 eval 轮处理，不阻塞本任务。
- **测试面**（复杂逻辑，该写）：引号行内配对与未闭合豁免、等长视图偏移一致性、density 门槛 AND 组合、position 窗口可见字数、ignoreTerms 重叠语义、not-is handler 的排除矩阵（直接把 check-ai-patterns 注释里的校准例句搬成用例）。

## 8. 实施顺序（并入 Task 23 分片 1）

1. `ScanContext` + 引号遮罩 + 三层视图 + scope 字段（含测试）。
2. `ignoreTerms`。
3. regex 规则差集导入（voice-contrast 等 + 词表差集，声明 scope）。
4. `density` detector + 密度规则移植。
5. handler 注册表 + 4 条首批 handler。
6. SKILL.md / references 文档同步（scope、density、ignoreTerms 的用户说明）。

## 9. 评审修订（v3.1，已并入上文相应小节）

七视角自评后确认的修订与新增不变量：

1. **［bug］auto 修复 × scope 不变量**：`fixability:auto` 的规则**必须 `scope: all`**，loader 校验，违者 diagnostic error 不激活。理由：fix 是拿命中区间改原文的；narrative/dialogue 视图里引号段是 `。` 占位串，`。。` 这类去重 auto 规则若跑在派生视图上会把占位符当真命中、写坏原文。fix 管线只消费 all 层就永远安全。
2. **［bug］quote-emphasis 落位改 handler**：§6 表已改。narrative 视图连引号带内容一起占位，density 模式看不到「引号短词」；其排除逻辑（邻接引语动词、嵌套引号、无叙述行）本就超出声明式表达力。
3. **［缺口］引号配对先避开 markdown 遮罩区**：§1 已补。代码块里的 `「` 不能制造假对白区。
4. **［缺口］结构行豁免**：ScanContext 增加 `lines`（带 `structural` 标记），density/handler 统计默认跳过结构行与章节标题行；逐处 regex 规则不受影响。§1 已补。
5. **［缺口］未知 detector.type 前向兼容**：loader 遇到未知 `detector.type` / 未注册 handler 名，**skip + diagnostic warning，不抛错**。规则共享生态下，老版本 skill 装到新版规则包必须优雅降级，这是「用户供规则」路线的硬前提。
6. **［不变量文档化］narrative 视图的占位符语义**：narrative 规则作者须知——引号段在视图中呈现为等长 `。` 串；规则模式不得依赖「数句号」类判断（那类需求写 density/handler，其分母与计数会正确跳过占位与结构行）。选 `。` 正是为了让 `[^。，]` 字符类天然截断，这是特性不是缺陷。
7. **［校验］density 声明校验**：`patterns` 非空、`minHits ≥ 1`、`granularity:paragraph` 时按行评估；samples 上限 8 条在 scanner 内硬编码（不进 schema）。
8. **［登记］CONTEXT.md 硬不变量**：实施时把 1/5/6 三条注册进 CONTEXT.md 的 I 序列（自动修复域约束 / 未知类型降级 / 占位视图语义）。
9. **［既成约束确认］**：浏览器端 RegExp lookbehind（Safari 16.4+）在现有规则里已是事实依赖（dash-proliferation 用了 `(?<!…)`），v3 不新增约束；stylish reporter 需为 DensityIssue 增加 hits/perKilo/samples 渲染，随 §8 第 4 步实施。

评审后维持不变的判断：三层等长视图的两份全文拷贝在十万字章节量级下成本可忽略；dialogue 层虽 v1 只有公文腔一条消费，但它是 narrative 补集的自然副产物，不值得砍；`granularity:paragraph` 维持本轮做（已拍板）。

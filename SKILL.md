---
name: llmlint
description: Lint and polish LLM-generated Chinese text by detecting template-like wording, AI writing tells, hollow summaries, rhythm issues, and rule-driven style problems. Use when the user asks to polish text, check whether writing feels AI-like, lint LLM output, review prose naturalness, or configure llmlint rules.
when_to_use:
  - 用户请求润色文本、检查 AI 味、优化自然度或审查套路化表达
  - 用户显式提到 llmlint、文本 lint、LLM 输出规范或规则配置
  - 用户提供 Markdown / 纯文本文件并要求生成修复计划或改写建议
metadata:
  author: NeuroBook Team
  version: 2.0.0
---

# llmlint

llmlint 是面向 LLM 输出的文本 lint skill。CLI 负责稳定、可复现的候选定位；Agent 负责结合语境做语义审查、评分、修复计划和用户审批式改写。

## Quick Start

检查文件中的 regex detector 候选：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径>
```

`check` 可传多个文件、目录或 glob 模式（目录递归 `.md` / `.markdown` / `.txt`；模式支持 `**` 递归与 `!` 排除）。对 Markdown 文件默认跳过代码块 / frontmatter / 行内代码 / 链接等结构区域，避免误杀；`--scan-all` 关闭遮罩：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check manuscript/            # 递归整部稿件
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check 'manuscript/**/*.md'   # glob 模式（引号防 shell 展开）
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check a.md b.md --scan-all   # 多文件 + 不跳过结构区
```

应用确定性机械修复（仅 `fixability: auto`：零宽字符、连续符号去重），默认 dry-run 预览，`--write` 才落盘：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts fix <文件或目录>             # 预览将修复什么（退出码 1 表示有待修）
bun .nbook/agent/skills/llmlint/bin/llmlint.ts fix <文件或目录> --write     # 写回原文件
```

> `fix` 只做无需判断的机械修复（auto 桶）；删填充词、改写句式等语义修复仍由 Agent 读上下文、经你审批后写入 `.agent/polish-output.md`，不在 `fix` 范围。

显示需要 Agent 主动全文审查的 LLM rules：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts show-llm-rules
```

指定配置文件：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts --config llmlint.config.ts check <文件路径>
```

输出 JSON：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts --format json check <文件路径>
```

长文件先看中高等级候选：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径> --min-level medium
```

小文件或人类阅读时显示完整命中行：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径> --show-lines
```

## Workflow

1. 获取输入文本：用户给路径时直接使用；用户粘贴文本时写入 `.agent/polish-input.md`。
2. 运行 `check`：读取 regex detector 命中项。命中只代表候选，不代表必须修复；默认输出按 high / medium / low 分段，并显示行列范围与命中文本。需要完整原文行时加 `--show-lines`。
3. 运行 `show-llm-rules`：逐条阅读全文审查 llm detector 规则，并记录“未发现候选 / 建议修复 / 建议保留 / 需要确认”。
4. 完成快速审查评分：Directness、Rhythm、Trust、Authenticity、Density 各 1-10 分，总分 50。
5. 生成 `.agent/polish-plan.md`：统计、评分、修复详情、不确定项和建议。
6. 用户审批后执行修复：默认写入 `.agent/polish-output.md`；只有用户明确要求时才改原文件。
7. 输出报告：总候选数、已修复、保留原因、评分变化和输出位置。

## Config

默认启用 `builtin/default` ruleset。它合并了人工维护的 anti-ai-slop 规则与中文规则样本的策展结果，已包含 R18/成人词汇规则；普通项目可用 `namespaces: {"vocabulary.r18": "off"}` 关闭。

`builtin/default` 已取三个同类项目（shuorenhua「说人话」为主，avoid-ai-writing、humanizer 为辅）的精华扩充成体系规则：新增 `opening.cliche`（开场套话）、`inflation.significance`（渲染性强调）、`transition.summary`（过渡废话）、`attribution.vague`（无源引用）、`cliche.uplift`（正能量收尾）、`sycophantic`（谄媚/助手腔）等默认展示命名空间，以及 `jargon.engineer`、`jargon.social`、`translationese`、`structure.fragment` 等默认归 human 桶的高误杀命名空间，外加一组移植自 avoid-ai-writing 的机械痕迹规则 `mechanical.*`（零宽字符、同形字、未填充占位符、chatbot 泄漏标记，语言无关、高精度）。这些规则在小说正文里多为休眠状态、几乎不增噪，遇到 AI 文章/聊天腔或粘贴泄漏时密集命中。完整清单见 [patterns.md](references/patterns.md)。

`builtin/default` 内部固定从 `rules/` 目录递归加载规则文件，例如 `rules/filler/index.json`、`rules/abstraction/hollow.json`、`rules/vocabulary/r18.json`。目录层级只方便维护者阅读，规则语义只来自每条 rule record 的 `namespace`。用户配置仍以 ruleset、namespace、rule id 为入口；不要通过手改内置规则文件来开关某类规则。

项目可放置 `llmlint.config.ts`：

```typescript
export default {
    rulesets: [
        "builtin/default",
    ],
    trustedRulesets: [],
    rulesetOverrides: {},
    namespaces: {
        modifier: "medium",
        "vocabulary.r18": "off",
        "商务黑话": "off",
    },
    rules: {
        "filler-word-actually": "warn",
        "firstly-secondly": "error",
        "filler-lets": "off",
    },
    output: "stylish",
};
```

`rulesets` 是安装和启用单元；配置只能选择已经安装在 `rulesets/` 下的规则包。同一个 ruleset 内部必须把规则放进 `rules/` 目录，loader 会递归扫描所有 `.json` 规则数组文件；这只是资产组织方式，不改变配置入口。同 namespace 不同 id 会追加；同 id 会由后加载的 ruleset 覆盖前者，并产生 diagnostics。官方推荐入口是 `builtin/default`。

覆盖优先级：rule id > namespace > ruleset > rule 默认 enabled / level。namespace 负责分类和批量开关，rule id 负责精确定位和覆盖。namespace 推荐使用稳定英文 key，也支持内置中文 alias，例如 `商务黑话` 会归一到 `jargon.business`。

规则有三个独立维度：`level`（严重度）、`review`（审查受众：agent/human/none）、`fixability`（修复能力：auto/candidate/manual）。`check` 默认只展示 `review: agent` 的命中——破折号、比喻、泛词形副词等更偏作者偏好的命名空间默认归到 `human`，连续符号去重等机械命名空间归到 `none`。用 `--review human` / `--review all` 查看其它桶。

规则覆盖值（namespace 和 rules 通用）。两种写法会归一成同一个 patch：字符串是语法糖，对象是显式 patch。
- 字符串简写：
  - `off`：禁用规则（= `{enabled: false}`）
  - `warn`：启用并作为 medium 级别（= `{enabled: true, level: "medium"}`）
  - `error`：启用并作为 high 级别（= `{enabled: true, level: "high"}`）
  - `low` / `medium` / `high`：启用并指定级别（= `{enabled: true, level: X}`）
- 对象形态：`{ enabled?, level?, review?, fixability? }`，只覆盖显式设置的字段，其余保持不变。
  - 想启用一条默认禁用的规则并同时调级别/受众时，必须显式写 `enabled: true`（纯属性对象不改启停状态）：

```typescript
rules: {
    // 启用一条默认禁用的规则，并设为 high、交人工审查
    "modifier.extreme.some-rule": {enabled: true, level: "high", review: "human"},
    // 只调受众，不动启停与级别
    "filler-word-actually": {review: "agent"},
},
namespaces: {
    "punctuation.dash": {review: "human"},
},
```

## Judgment Rules

- High：强烈建议修复，但仍需确认语境；技术步骤或报告提纲可能合理。
- Medium：读取前后文后判断；对话口癖、人物声音、引用和讽刺可能应保留。
- Low：默认保留，除非明显降低密度、自然度或可信度。
- 不熟悉专有名词、同人梗、科幻设定、历史事实或领域知识时，先调研再判断。
- 不要为了消除“AI 味”把作者风格、角色声音或有效文体特征磨平。

## References

- [CLI 详细使用说明](references/cli-usage.md)
- [中文文本润色模式库](references/patterns.md)
- [完整流程详解](references/workflow.md)

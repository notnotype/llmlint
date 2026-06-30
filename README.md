# llmlint

> 为 LLM 生成的中文文本做 lint 与润色 —— 用规则稳定定位 AI 味，再交给人/Agent 结合语境判断修复。

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm--Noncommercial--1.0.0-blue.svg)](./LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-black.svg)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-2.0.0-green.svg)](./package.json)

**中文 · [English](./README.en.md)**

---

## llmlint 是什么

**llmlint** 是面向 LLM 输出的中文文本 lint 工具。它定位套路化表达、AI 写作痕迹、空泛总结、节奏单调等规则驱动的风格问题，再帮你修复 —— 同时不把作者或角色本来的声音磨平。

它由两层协作组成：

| 层 | 职责 |
| --- | --- |
| **CLI**（本仓库 `bin/llmlint.ts`） | 用 regex detector 做**稳定、可复现的候选定位**，告诉你*哪里*可能有问题。 |
| **Agent Skill**（`SKILL.md`） | 由 LLM/Agent 结合**语境**复核候选、给文本评分、生成修复计划，并*在你审批之后*才改写。 |

核心理念：**命中只是候选，不是判决。** CLI 永远不会自动改写正文。只有无需判断的机械清理（零宽字符、连续符号去重）才由 `fix` 处理；所有语义级修复都交给人/Agent。

## 为什么需要它

LLM 的中文输出有可识别的"味道"：填充开场（其实、值得注意的是）、机械过渡（首先…其次…最后）、二元对比脚手架（不是…而是…）、商务黑话（赋能、抓手、闭环）、渲染性强调（深刻的影响、前所未有）、谄媚助手腔（好问题、希望这对你有帮助）等等。它们大多能被正则*稳定定位*，但*该不该删*要看语境 —— 一句对白、一份技术文档、或一个刻意的修辞，都可能合理地保留它们。

llmlint 把这两件事拆开：确定性定位（CLI）+ 语境判断（Agent）。

## 运行要求

- [Bun](https://bun.sh)（CLI 直接跑 TypeScript，无需构建）
- 依赖：`commander`、`picocolors`、`tinyglobby`（均为极轻量纯 JS 库，无原生编译）

## 安装

```bash
git clone https://github.com/notnotype/llmlint.git
cd llmlint
bun install
```

直接运行：

```bash
bun bin/llmlint.ts check <文件>
```

或把 `llmlint` 命令注册到 PATH（`package.json` 的 `bin` 已声明）：

```bash
bun link
llmlint check <文件>
```

> `SKILL.md` / `references/` 里把 CLI 写成 `bun .nbook/agent/skills/llmlint/bin/llmlint.ts …`，那是 llmlint 作为**内嵌 Agent Skill** 安装时的路径（见 [作为 Agent Skill 使用](#作为-agent-skill-使用)）。独立使用时直接 `bun bin/llmlint.ts …` 即可。

## 快速开始

```bash
# 定位文件（或目录，递归 .md/.markdown/.txt）中的 regex 候选
bun bin/llmlint.ts check manuscript/chapter-01.md
bun bin/llmlint.ts check manuscript/

# 长文件先看中高等级
bun bin/llmlint.ts check chapter.md --min-level medium

# 小文件 / 人类阅读：显示完整命中行，用 <mark> 标出命中片段
bun bin/llmlint.ts check chapter.md --show-lines

# 列出需要 Agent 全文审查的 LLM 规则
bun bin/llmlint.ts show-llm-rules

# 确定性机械修复（零宽字符、连续符号去重）—— 默认 dry-run
bun bin/llmlint.ts fix manuscript/             # 仅预览（有待修项时退出码 1）
bun bin/llmlint.ts fix manuscript/ --write     # 写回原文件

# JSON 输出，供工具消费
bun bin/llmlint.ts check chapter.md --format json
```

对 Markdown，`check` / `fix` 默认跳过代码块 / frontmatter / 行内代码 / 链接等结构区，避免把代码、URL 当正文误杀；`--scan-all` 关闭遮罩、扫描全部内容。

## 三个独立维度

每条规则有三条互相独立的轴，不要混为一谈：

- **`level`** —— `high` / `medium` / `low`。只表严重度，决定 `--min-level` 过滤和退出码。
- **`review`** —— `agent` / `human` / `none`。*审查受众*：一条命中默认给谁看。`check` 默认 `--review agent`，把破折号、比喻、泛词形副词等更偏作者偏好的命中放进 `human` 桶、机械命中放进 `none` 桶。用 `--review human` / `--review all` 查看其它桶。
- **`fixability`** —— `auto` / `candidate` / `manual`。机械修复能力。`fix` 只应用 `auto` 规则。

`review`（受众）和 `detector`（检测手段）是**两个不同概念**：

- **`detector`** 决定问题*怎么被发现*：`regex` 由 `check` 静态扫描命中；`llm` 由 `show-llm-rules` 交给 Agent 全文审查。
- **`review`** 决定一条 regex 命中*默认给谁看*。

一次完整审查要同时跑 `check`（给 Agent 的 regex 命中）和 `show-llm-rules`（全文语义规则）。

## 配置

多数项目**不需要任何配置** —— 不放 `llmlint.config.ts` 时默认加载 `builtin/default` 和一套调好的命名空间策略。需要定制时，在目录树任意上层放一个 `llmlint.config.ts`（从 cwd 向上自动查找）：

```typescript
export default {
    rulesets: ["builtin/default"],
    namespaces: {
        "vocabulary.r18": "off",          // 普通项目关闭成人词汇规则
        "商务黑话": "off",                  // 中文 alias → jargon.business
        "jargon.engineer": {review: "agent"}, // 把某个桶移进 agent 视图
    },
    rules: {
        "filler-word-actually": "warn",
        "firstly-secondly": "error",
        "filler-lets": "off",
    },
    output: "stylish",
};
```

- **覆盖优先级：** rule id > namespace > ruleset > rule 默认。
- **字符串简写**是对象 patch 的语法糖：`off` = `{enabled:false}`，`warn` = `{enabled:true, level:"medium"}`，`error` = `{enabled:true, level:"high"}`，`low`/`medium`/`high` 直接设级别。对象形态 `{enabled?, level?, review?, fixability?}` 只覆盖你显式设置的字段 —— 想启用一条默认禁用的规则必须显式写 `enabled: true`。
- **命名空间**接受稳定英文 key 和内置中文 alias（如 `商务黑话` → `jargon.business`）。

完整带注释示例见 [`llmlint.config.example.ts`](./llmlint.config.example.ts)。

## 内置规则集：`builtin/default`

官方推荐规则集 —— 约 340 条规则、覆盖 40+ 命名空间，由人工维护的 anti-AI-slop 规则与中文规则样本（`shuorenhua` 说人话 / `avoid-ai-writing` / `humanizer`）策展合并而来。

- **agent 桶（默认展示）：** `filler`、`opening.cliche`、`inflation.significance`、`transition.summary`、`attribution.vague`、`cliche.uplift`、`sycophantic`、`jargon.business`……
- **human 桶（高误杀 / 作者偏好）：** `punctuation.dash`、`metaphor`、`modifier`、`jargon.engineer`、`jargon.social`、`translationese`、`structure.fragment`……
- **none 桶（机械类）：** `punctuation.dedup`、`mechanical.zero-width`。
- **`mechanical.*`（语言无关、高精度）：** 零宽字符、同形字、残留的 `{{占位符}}`、复制 AI 输出带进来的角标（`:contentReference`、`oaicite`……）。

内置已包含 R18 / 成人词汇规则；普通项目用 `namespaces: {"vocabulary.r18": "off"}` 关闭即可，不必手改规则文件。

## 退出码

- `0` —— 未发现问题，或只有 `low`/`medium` 级别可见。
- `1` —— 存在可见的 `high` 问题、CLI 执行失败，或（`fix` dry-run 下）存在待修复项。

退出码跟随**当前可见视图**：被 `--review` / `--min-level` 隐藏的命中不计入。需要让所有 high 命中都参与判定（如 CI 门禁「禁止零宽字符入库」）时用 `--review all --min-level low`。

## 作为 Agent Skill 使用

本仓库同时是一个自包含的 **Agent Skill**。`SKILL.md` 定义了 6 步润色流程：获取输入 → `check` → `show-llm-rules` + 50 分快速审查 → 修复计划（用户审批）→ 执行修复 → 生成报告。安装时把整个目录复制进 Agent 的 skills 目录，例如 `.claude/skills/llmlint/` 或 NeuroBook 的 `.nbook/agent/skills/llmlint/`，Agent 即可按文档流程驱动 CLI。

## 文档

- [`SKILL.md`](./SKILL.md) —— Agent Skill 清单与工作流契约
- [`references/cli-usage.md`](./references/cli-usage.md) —— CLI 完整参考（参数、输出格式、JSON schema）
- [`references/patterns.md`](./references/patterns.md) —— 中文文本模式库（每条规则查什么、何时该保留）
- [`references/workflow.md`](./references/workflow.md) —— 6 步润色流程详解

## 许可证

[PolyForm Noncommercial License 1.0.0](./LICENSE) —— 任何非商业用途（个人使用、研究、教育、非营利组织、政府机构）均可免费使用；商业用途需另行授权。Copyright © 2026 notnotype。

---

> English version: **[README.en.md](./README.en.md)**

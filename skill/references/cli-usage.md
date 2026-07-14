# CLI 工具使用说明

> 下文命令用 `bun` 演示；CLI 是 TypeScript，参数与运行器无关 —— Bun 原生运行，Node 通过 [`tsx`](https://github.com/privatenumber/tsx) 运行（把 `bun` 换成 `npx tsx`）。裸 `node` 不行：源码用了无扩展名相对导入，需 `tsx` 或 Bun 解析。首次使用若报缺依赖，在 skill 目录运行一次 `npm install`（或 `bun install` / `pnpm install`）。

## 基本用法

检查文件中的 regex detector 命中项：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径>
```

显示需要 Agent 主动全文审查的 LLM 规则：

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
bun .nbook/agent/skills/llmlint/bin/llmlint.ts --format json show-llm-rules
```

长文件按最低级别过滤：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径> --min-level medium
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径> --min-level high
```

按审查受众过滤（默认 `agent`，只展示需要 Agent/LLM 处理的命中）：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径>                 # 等同 --review agent
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径> --review human  # 偏作者人工/风格偏好的命中
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径> --review none   # 机械/诊断类命中
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径> --review all    # 不按受众过滤，全部展示
```

显示完整命中行：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径> --show-lines
```

检查多个文件或整个目录（目录递归收集 `.md` / `.markdown` / `.txt`）：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check a.md b.md
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check manuscript/
```

也支持 glob 模式（`**` 递归、`!` 排除、`{a,b}` 花括号）：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check 'manuscript/**/*.md'
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check 'manuscript/**/*.md' '!manuscript/drafts/**'
```

> glob 模式按相对当前工作目录解析；用引号包住模式，避免被 shell 提前展开。目录参数（如 `manuscript/`）则在该目录内递归。

对 Markdown 文件，默认跳过代码块 / frontmatter / 行内代码 / 链接等结构区域，避免把代码、链接当正文误杀。`--scan-all` 关闭遮罩，扫描全部内容：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check chapter.md --scan-all
```

## fix：确定性机械修复

`fix` 只应用 `fixability: auto` 的规则——零宽字符删除、连续符号去重等**无需判断**的机械修复。删填充词、改写句式等语义修复不在此列，仍由 Agent 读上下文、经用户审批后处理（默认写 `.agent/polish-output.md`）。

默认 dry-run：只打印将修复什么（含 before → after 预览，零宽等不可见字符会被显形为 `▯`），不改文件；存在待修复项时退出码为 `1`（可用于「禁止零宽字符入库」一类 CI 门禁）。`--write` 才写回原文件：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts fix manuscript/            # 预览（不落盘）
bun .nbook/agent/skills/llmlint/bin/llmlint.ts fix manuscript/ --write    # 写回原文件
bun .nbook/agent/skills/llmlint/bin/llmlint.ts fix chapter.md --format json
```

`fix` 同样默认尊重 Markdown 遮罩：代码块 / frontmatter 内的内容不会被改动，`--scan-all` 可关闭。

## check 输出格式

`check` 只运行 regex detector。regex detector 表示“候选文本可以被稳定识别”，不表示一定要修复。

每条规则有三个互相独立的维度：
- `level`（high / medium / low）：只表严重度，决定 `--min-level` 过滤和退出码。
- `review`（agent / human / none）：审查受众，决定默认进入哪个审查出口。`check` 默认只展示 `review: agent` 的命中，把破折号、比喻、泛词形副词等更偏作者偏好的命中归到 `human`，把连续符号去重等机械命中归到 `none`。
- `fixability`（auto / candidate / manual）：机械修复能力，决定能否被 `fix` 命令自动改写。`fix` 只应用 `auto` 桶（零宽字符、连续符号去重）；`check` 永远不改写。

默认规则集的实际分布约为 `auto=3 / candidate=0 / 其余 manual`。`action.type: "replace"` 与 `action.replacement` 只说明规则带有替换模板，不代表模板可直接执行；应用权限由规则经过 ruleset、namespace、rule 配置覆盖后得到的最终 `fixability` 决定。用户可显式把指定 regex replace 规则提升为 `candidate`，供逐条人工确认。

默认输出先按 high / medium / low 分段，再按规则分组。每条命中显示位置范围和命中文本，不重复打印完整原文行：

```text
manuscript/chapter-01.md

filler-word-actually [filler] (无意义填充词)
  来源：builtin/default；级别：medium；审查：agent；修复：candidate
  1:9-10  match: 其实

  1 occurrence. 建议删除。

✖ 1 problem (1 medium) 已隐藏：78 条按审查受众隐藏。
```

加 `--show-lines` 时，命中行会改为完整原文行，并用 `<mark>` 标出命中片段：

```text
  1:9-10  这个问题很复杂。<mark>其实</mark>我们可以从另一个角度来看。
```

每个问题包含：
- 行号和闭区间列范围
- 命中文本
- rule id、namespace、ruleset 来源
- 规则级别统计
- 规则 action 中的删除、替换候选或提示

`--min-level` 会隐藏低于指定级别的候选，并在 stylish / JSON 输出中记录被隐藏数量。默认值是 `low`，即显示全部级别。
`--review` 会按审查受众过滤候选，默认 `agent`。`--review` 与 `--min-level` 是两个独立过滤器，被隐藏数量分别统计为“按审查受众隐藏”和“按级别隐藏”。
`--show-lines` 只影响 stylish 输出；JSON 始终保留完整 `context`。

## show-llm-rules 输出格式

`show-llm-rules` 输出纯文本，不使用 Markdown 标题格式。它用于告诉 Agent 本轮还要额外进行哪些全文语义审查。

示例：

```text
LLM 判断规则

说明：以下规则需要 Agent 根据上下文主动审查，不由 CLI 静态扫描命中。

规则 1: hollow-summary-paragraph - 空泛总结段

namespace: abstraction.hollow

来源: builtin/default

级别: medium

说明: 段落用抽象价值判断收束，却没有提供新的具体信息。

判断标准:

...

判断示例:

...
```

如果没有启用 LLM 规则，会输出：

```text
当前没有启用需要全文语义审查的 LLM 规则。
```

## JSON 输出格式

`check --format json` 输出：

```json
{
  "kind": "check",
  "filePath": "manuscript/chapter-01.md",
  "configPath": "llmlint.config.ts",
  "summary": {"total": 2, "high": 0, "medium": 2, "low": 0},
  "filter": {"review": "agent", "hiddenByReview": 78, "minLevel": "low", "hiddenByLevel": 0},
  "registry": {"rulesets": [], "totalRules": 0, "activeRules": 0, "disabledRules": 0, "namespaces": []},
  "diagnostics": [],
  "issues": []
}
```

检查多个文件时 `kind` 为 `"check-multi"`：顶层 `registry` / `diagnostics` / `filter` 为全局，`files[]` 给逐文件 `{filePath, summary, issues}`，`summary` 为聚合统计。`fix --format json` 输出 `kind: "fix"`，含 `write`、逐文件 `ruleCounts` 与 `totalOccurrences`。

`show-llm-rules --format json` 输出：

```json
{
  "kind": "llm-rules",
  "configPath": "llmlint.config.ts",
  "registry": {"rulesets": [], "totalRules": 0, "activeRules": 0, "disabledRules": 0, "namespaces": []},
  "diagnostics": [],
  "rules": []
}
```

## Regex Detector 与 LLM Detector

`regex` detector 负责定位候选文本，例如：
- 填充词：其实、实际上、事实上
- 机械过渡：首先...其次...最后...
- 二元对比：不是...而是...
- 问题定义对比：问题/答案/关键不是...是...
- 公式化设问：为什么这么说、这意味着什么、试想一下
- 强调拐杖：毫无疑问、显而易见、说到底、归根结底
- 元叙述公告：下面将介绍、接下来将、本文将从
- 商务黑话：赋能、抓手、闭环、拉通、落地等候选词
- 懒惰绝对词：所有人、永远、一定、毫无例外等候选词

`llm` detector 负责无法靠固定正则稳定定位的问题，例如：
- 空泛总结段
- 语体错位
- 节奏单调
- 过度解释
- 缺少具体信息
- 隐藏行动者
- 金句感
- 段尾机械升华

二元对比、公式化设问、商务黑话等虽然可以被 regex detector 定位，但修复决策仍需要上下文判断。不要因为 CLI 命中就自动修改。

### detector 与 review 是两个不同概念

- `detector`（regex / llm）决定**用什么手段检测**：regex 由 `check` 静态扫描命中，llm 由 `show-llm-rules` 交给 Agent 全文审查。
- `review`（agent / human / none）决定一条 regex 命中**默认给谁看**。`check --review agent` 是 regex 命中里需要 Agent 处理的审查入口；它和 `show-llm-rules`（detector 为 llm 的全文语义规则）是两个互补的 Agent 审查面，完整审查时两者都要跑。

## 彩色输出

stylish 输出在交互式终端（TTY）下按语义着色：级别 high 红、medium 黄、low 暗；规则 id 青色、命中文本黄色、汇总 `✖` 红 / `✓` 绿；`fix` 预览 before 红、after 绿。
被管道、重定向或 Agent 抓取（非 TTY）、设置环境变量 `NO_COLOR`、或用 `--format json` 时，自动退化为纯文本，不输出任何 ANSI 转义码，保证机读安全。

## 退出码

- `0`：未发现问题，或只有 low/medium 级别问题
- `1`：发现 high 级别问题，或 CLI 执行失败

退出码跟随当前可见视图：只对未被 `--review` / `--min-level` 过滤掉的 high 命中置 `1`；被隐藏桶（如 `--review agent` 默认隐藏的 human/none 命中）不影响退出码。需要让所有 high 命中都参与判定时用 `--review all --min-level low`。

多文件 check 的退出码取各文件的或：任一文件存在可见 high 命中即 `1`。`fix` 的退出码：dry-run 下存在待修复项为 `1`、无待修为 `0`；`--write` 成功落盘为 `0`。

在 Agent 工作流程中，退出码 `1` 不一定代表命令失败；需要结合 stderr 和输出内容判断。

## 在 Agent 中使用

标准流程：

1. 执行 `check <file>`，获取 regex detector 命中项。
2. 执行 `show-llm-rules`，获取需要主动全文审查的 LLM 规则。
3. 复核 regex 命中项，读取上下文后判断修复、保留或需要用户确认。
4. 对每条 LLM rule 主动审查全文；没有候选也要在计划中说明“未发现明显问题”。
5. 执行快速审查清单，并给出 Directness / Rhythm / Trust / Authenticity / Density 五维评分。
6. 用面向用户的 Markdown 生成审查结论和修复计划，不要输出 JSON、YAML 或 TypeScript interface。

## 常见问题

### 为什么“不是...而是...”不是 LLM rule？

因为它可以被正则稳定识别。它确实需要上下文判断是否修复，但这是“修复决策”需要 LLM，不是“候选定位”需要 LLM。

### 为什么 CLI 没有输出 50 分评分？

评分依赖全文语气、语境、节奏和作者意图，由 Agent 在步骤 3 完成。CLI 只负责确定性候选定位。

### CLI 工具可以自动修复吗？

只有 `fixability: auto` 的机械规则（零宽字符、连续符号去重）可由 `fix` 命令确定性修复（见上文「fix」节：默认 dry-run，`--write` 才落盘）。删填充词、改写句式等语义修复不在此列，仍由 Agent 读上下文、经用户审批后执行。`check` 本身永不改写正文。

### 如何配置规则包？

优先创建 `llmlint.config.ts` 选择已经安装的 ruleset，并按 namespace 或 rule id 调整级别：

```typescript
export default {
    rulesets: [
        "builtin/default",
    ],
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
};
```

合并顺序由 `rulesets` 数组决定。同一个 ruleset 内部固定从 `rules/` 目录递归加载所有 `.json` 规则数组文件；目录层级只是内置资产维护结构，不是新的用户配置入口。同 namespace 不同 id 会追加；同 id 会被后加载规则覆盖，CLI 会在 diagnostics 中提醒来源变化。

覆盖值可用字符串简写或对象。字符串是对象的语法糖：`off` = `{enabled:false}`，`warn`/`error`/级别 = `{enabled:true, level:X}`。对象 `{ enabled?, level?, review?, fixability? }` 只覆盖显式字段；想启用一条默认禁用的规则必须显式写 `enabled: true`（纯属性对象如 `{review:"human"}` 不改启停状态）。

默认配置会启用 `builtin/default`。它已包含 R18/成人词汇规则；普通项目可用 `namespaces: {"vocabulary.r18": "off"}` 关闭，不需要手改 `rules/vocabulary/r18.json`。

### CLI 工具支持哪些文件格式？

任何 UTF-8 编码的文本文件。通常用于 Markdown 和纯文本文件。

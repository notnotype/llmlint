# llmlint 开发仓

`llmlint` 是面向 LLM 输出的中文文本 lint 工具。本仓库根目录是开发工作区，真正可安装的 Agent Skill / CLI package 位于 [`skill/`](./skill/)。

## 安装 Skill

推荐通过 `skills` CLI 安装仓库里的 `llmlint` skill：

```bash
npx skills add notnotype/llmlint --skill llmlint --full-depth
```

手动安装时，复制 [`skill/`](./skill/) 目录，并在目标 Agent 的 skills 目录中命名为 `llmlint/`。安装后进入该目录运行一次依赖安装：

```bash
cd skill
bun install
bun bin/llmlint.ts check <file>
```

## 开发

```bash
bun install
bun test
bun run typecheck
bun run eval:fixture
```

`evals/` 是规则评测 harness 与基线语料，进入本仓库 git；临时评测输出建议写到 `.agent/evals/` 或 `evals/tmp/`。

NeuroBook 内置副本不是开发真相源。修改 `skill/` 后，从本仓库根执行：

```bash
bun run sync:neuro-book
```

它会把 `skill/` 镜像到 sibling NeuroBook 仓库的 `assets/workspace/.nbook/agent/skills/llmlint/`。

## 许可证

本开发仓与可安装的 `skill/` package 均采用 [GNU Affero General Public License v3.0（仅此版本）](./LICENSE)，SPDX 标识为 `AGPL-3.0-only`。Copyright © 2026 notnotype。

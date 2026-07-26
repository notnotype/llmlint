# llmlint 开发仓

`llmlint` 是面向 LLM 输出的中文文本 lint 工具：用规则稳定定位「AI 味」，再交给人 / Agent 结合语境判断修复。

本仓库根目录是**开发工作区**（`llmlint-dev`），承载测试、评测（`evals/`）与检测网站（`web/`）。真正可安装、可发布的 Agent Skill / CLI package 位于 [`skill/`](./skill/)（package name = `llmlint`，即唯一真相源）。

仓库分三个工作面，按需要跳读：

| 工作面 | 位置 | 用途 | 详细文档 |
| --- | --- | --- | --- |
| **Skill / CLI** | [`skill/`](./skill/) | 可安装、可发布的引擎与命令行 | [`skill/README.md`](./skill/README.md) |
| **开发工作区** | 仓库根 | 跑测试、类型检查、评测 harness | 本文件 + [`evals/README.md`](./evals/README.md) |
| **检测网站** | [`web/`](./web/) | 浏览器本地检测 + 判定标签采集站 | [`web/README.md`](./web/README.md) |

---

## 环境要求

- **Bun ≥ 1.3**；或 **Node ≥ 22.19 + `tsx`**
- **Git**

---

## 面向使用者

把 `llmlint` 作为 Agent Skill / CLI 使用，检测并润色中文文本。

### 安装

推荐通过 `skills` CLI 安装仓库里的 `llmlint` skill：

```bash
npx skills add notnotype/llmlint --skill llmlint --full-depth
```

手动安装时，复制 [`skill/`](./skill/) 目录，在目标 Agent 的 skills 目录中命名为 `llmlint/`。首次启用该 skill 时，必须先在 skill 根目录安装依赖，再运行任何 llmlint CLI 命令：

```bash
cd skill
bun install --frozen-lockfile
```

Agent 实际运行时优先使用 SkillCatalog 提供的绝对 skill root；宿主只提供 `SKILL.md` locator 时使用其父目录，不依赖 `.nbook`、`.claude`、`.codex` 等固定安装目录。Skill 版本以 `skill/package.json.version` 为准。

`SKILL.md` 会把这一步作为 `status` 之前的依赖门；同一份安装后续使用无需每轮重复执行。

### 配置

依赖安装完成后无需额外配置，引擎与规则即可使用；CLI 参数、输出格式与 JSON schema 见 [`skill/references/cli-usage.md`](./skill/references/cli-usage.md)。

### 启动

```bash
# 在 skill/ 目录内
bun bin/llmlint.ts check <file>      # Bun 原生
npx tsx bin/llmlint.ts check <file>  # Node + tsx
```

---

## 面向开发者

改引擎 / 规则 / 评测（仓库根开发工作区），或开发检测网站（`web/`）。

### 安装

```bash
# 仓库根：开发工作区依赖（tests / evals / 开发工具）
bun install

# 检测网站依赖（独立声明，不随根工作区安装）
cd web && bun install
```

> `web/` 依赖与 SQLite 库都要单独初始化，`web/node_modules` 不随根工作区安装。

### 配置

开发工作区本身无需配置。检测网站首次需初始化 `.env` 与数据库（在 `web/` 目录）：

```bash
cp .env.example .env                     # 按需改 DATABASE_URL / NUXT_AUTH_ENABLED / NUXT_SESSION_PASSWORD
bun run db:init && bun run db:generate   # ① 建库表 ② 生成 prisma client
```

注意：

- 必须先 `db:init` 再启动 web，这是一次性步骤，之后除非删库或新增 migration，不必重跑。
- `.env` 里必须有 `DATABASE_URL`。

**外部 AIGC 检测 / LLM Agent 通道（可选）**：这两条服务端通道读仓库根的 `evals/eval.config.json`（不存在则自动禁用，不影响其它功能，无网页配置入口）。启用步骤：

```bash
cp evals/eval.config.example.json evals/eval.config.json   # 在仓库根
```

编辑 `evals/eval.config.json`：

- `detector` 节 → 外部 AIGC 检测（HF 公共 Space，无需 key）；国内访问填 `proxy`，直连则删除该字段。
- `repair.model` / `classifier.model` → LLM Agent 用的 `provider/model`。
- `modelsConfig` → 指向含 `apiKey` 的模型配置文件（NeuroBook `config.json` 格式）；**API key 只写在此文件，绝不进任何入 git 的文件**。

改配置后需重启 `bun run dev` 才生效。

### 启动

开发工作区（仓库根）——测试、类型检查、评测：

```bash
bun test               # 单元测试（vitest）
bun run typecheck      # tsc --noEmit
bun run verify         # 一键：typecheck + test + CLI 冒烟（--version / show-llm-rules）
bun run eval:fixture   # 用 fixture 语料跑一遍评测，输出到 .agent/evals/fixture-report
```

检测网站——`web/` 目录内直接起，或回仓库根用透传脚本：

```bash
cd web && bun run dev    # 预烘 registry/report 后起 nuxt dev（默认 http://localhost:3000）
bun run web:dev          # 等价，在仓库根执行（另有 web:generate / web:typecheck）
```

延伸阅读：

- `web/` 的 **Nuxt 4 SPA（`ssr:false`）+ Nitro server/api** 形态、鉴权、数据模型、API、构建期预烘与部署，见 [`web/README.md`](./web/README.md)。
- 评测**方法论**见 [`evals/METHODOLOGY.md`](./evals/METHODOLOGY.md)（本项目最核心部分）；harness **用法**见 [`evals/README.md`](./evals/README.md)。
- `evals/`（含 `corpus/`）是开发仓一等资产，整体进 git；临时评测输出建议写到 `.agent/evals/` 或 `evals/tmp/`。
- 术语与硬不变量以 [`CONTEXT.md`](./CONTEXT.md) 为唯一真相源；仓库现状 / 当前重点 / TODO 见 [`PROJECT-STATUS.md`](./PROJECT-STATUS.md)。

---

## 同步到 NeuroBook

NeuroBook 内置副本**不是**开发真相源。修改 [`skill/`](./skill/) 后，从仓库根执行：

```bash
bun run sync:neuro-book
```

它会把 `skill/` 镜像到 sibling NeuroBook 仓库的 `assets/workspace/.nbook/agent/skills/llmlint/`。该同步逻辑由 NeuroBook 侧维护，不在本仓职责内。

---

## 许可证

本开发仓与可安装的 [`skill/`](./skill/) package 均采用 [GNU Affero General Public License v3.0（仅此版本）](./LICENSE)，SPDX 标识为 `AGPL-3.0-only`。Copyright © 2026 notnotype。

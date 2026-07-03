# llmlint Standalone Development Repository

> 来源说明：本任务记录 llmlint 从 neuro-book 内嵌 skill 拆分为独立开发仓的过程。它执行时 llmlint 还内嵌在 neuro-book；现真相源已经是本仓（`github.com/notnotype/llmlint`），本文保留为「本仓由来」的历史记录。neuro-book 侧的 snapshot 同步机制由对方维护，不在本仓职责内。

## User Request / Topic

用户决定把 `llmlint` 从内嵌 skill 的复杂形态中独立出来：规则、CLI、评测 harness 后续还会继续膨胀，未来可能增加 web，因此需要一个真正独立的开发仓。

## 结果（当前仓库形态）

- 本仓（`github.com/notnotype/llmlint`）是 llmlint 真相源。
- 仓库根是开发工作区，承载 `skill/`、`evals/`、`tests/`、开发脚本和根 `package.json`（name=`llmlint-dev`）。
- 真正可安装 / 可发布的 Agent Skill / CLI package 固定为 `skill/`（`skill/package.json` name=`llmlint`）。
- `evals/` 进 git，作为评测 harness 与基线语料；不放进 `skill/`，因此不随可安装包分发。
- 本轮不做 monorepo / workspace；未来出现 web 再升级。

## 迁移实现（历史）

- 从原内嵌目录复制当前源码到独立仓，保留未提交源码改动与原先 ignored 的 `evals/`。
- 将 runtime package 下沉到 `skill/`；根目录新增开发 `package.json`、`tsconfig.json`、README / README.en。
- `tests/llmlint.test.ts` 迁出，改为直接 import `skill/src/*`；旧内部规则样本目录依赖改成最小 fixture。
- neuro-book 侧另有 sync 脚本从本仓 `skill/` 反向镜像 snapshot（排除 `.git/`、`node_modules/`、`.bun/`、`.agent/`、`evals/`、`tests/` 等），那套逻辑归 neuro-book 维护。

## Verification

- `bun install`（仓库根）
- `bun test`（仓库根）
- `bun run typecheck`（仓库根）
- `bun skill/bin/llmlint.ts --version`
- `bun skill/bin/llmlint.ts show-llm-rules --format json`
- `bun evals/score.ts --corpus evals/fixtures/corpus --out .agent/evals/fixture-report --min-support 1`

## References

- 可安装 skill package：`skill/`
- Rule registry history: [Task 02](../02-llmlint-rule-registry/README.md)
- Eval harness history: [Task 03](../03-llmlint-eval-harness/README.md)
- llmlint 历史源头: [Task 01](../01-anti-ai-slop-skill/README.md)

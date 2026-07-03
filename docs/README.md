# 文档索引

本目录保存 llmlint 开发仓的文档资产。稳定实现契约放在 `skill/references/`，仓库级现状放在根目录 `PROJECT-STATUS.md`。

## 目录分工

- `docs/tasks/`：重大任务的持续 walkthrough；active task 使用 `{order}-{slug}`，已归档任务放入 `docs/tasks/archived/`。
- `docs/research/`：第三方库、外部资料和方案调研。
- `docs/drafts/`：未定稿草案。
- `docs/archived/`：过期但仍有参考价值的文档。

## 关键入口

- [../CONTEXT.md](../CONTEXT.md)：项目领域语言（术语）+ 硬不变量（代码遵守）。
- [../evals/METHODOLOGY.md](../evals/METHODOLOGY.md)：评测方法论 / 流程规范（代码按它实现）。
- [../PROJECT-STATUS.md](../PROJECT-STATUS.md)：仓库现状和近期任务。
- [../README.md](../README.md) / [../README.en.md](../README.en.md)：项目入口（中文 / English）。
- [tasks/README.md](tasks/README.md)：任务 walkthrough 规则。
- [tasks/TEMPLATE.md](tasks/TEMPLATE.md)：新任务 walkthrough 模板。
- [../skill/references/cli-usage.md](../skill/references/cli-usage.md)：CLI 参数、输出格式、JSON schema 稳定参考。
- [../skill/references/patterns.md](../skill/references/patterns.md)：中文规则模式库。
- [../skill/references/workflow.md](../skill/references/workflow.md)：6 步润色流程。
- [../skill/SKILL.md](../skill/SKILL.md)：Agent Skill manifest 与工作流合同。
- [../evals/README.md](../evals/README.md)：评测 harness 说明。

## 维护规则

- 新文档先判断是否稳定：稳定实现契约进入 `skill/references/`，未稳定内容进入 `docs/drafts/`。
- 外部资料和技术选型调研进入 `docs/research/`，不要混入稳定参考。
- 重大任务完成后更新 `PROJECT-STATUS.md` 和对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`。
- 同一功能的后续调整继续更新原任务 walkthrough，除非目标已经明显独立。

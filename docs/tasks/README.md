# Task Walkthroughs

`docs/tasks/` 用来记录重大任务的持续过程。它不是一次性流水账，而是功能级、任务级的长期上下文。

## 何时创建或更新

- 会改变代码行为、架构决策、模块状态或长期 TODO 的任务，需要更新任务 walkthrough。
- 同一功能后续调节继续更新同一个任务目录，不要每轮新建碎片文档。
- 用户创建一个重要的讨论，或者架构设计。

## 命名

- Active task 使用 `{order}-{slug}` 目录名，例如 `01-anti-ai-slop-skill`、`02-llmlint-rule-registry`。
- `order` 使用两位数字，从 `01` 开始；active task 按 README 首次加入 git 的时间正序编号，缺少 git 记录时使用目录 LastWriteTime。
- `slug` 使用英文 kebab-case。
- 每个任务目录至少包含 `README.md`。
- 并不强制都把内容塞进 README.md，还可以在任务目录放其他相关文档，例如 `notes.md`、`data-acquisition.md`，或按轮次记录的 `walkthroughs/` 子目录。

## 归档

- `docs/tasks/archived/` 存放已归档 task，目录保留原 slug，不加 active 编号。
- 用户可以手动归档任务。
- archived task 不参与 active 编号，也不要求继续维护 `PROJECT-STATUS.md` 同步状态。

## goal 模式工作流程

如果你正在持续推进某个任务，则按照这个流程循环进行：

调研/计划 -> 编码/实现 -> 测试 -> 代码审查 <-> 修复（回到代码审查） -> 调研/计划 或者 结束任务

最后应该从用户的角度跑一个实际的例子，评估这个系统的好用程度和 bug，然后继续优化。（对 llmlint 而言，实际例子通常是用真实稿件跑一遍 `check`/`fix`，或用 `evals/` 跑一轮判别力评测。）

注意：实现的过程中如果堵塞，可以尝试稍微绕道，但是每次绕道都必须在 walkthrough 文件中记录好。重大出入则记录到 `README.md` 中。

## 同步要求

重大任务结束时同时更新：

- 根目录 `PROJECT-STATUS.md`
- 对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`

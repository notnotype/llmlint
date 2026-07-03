# AGENTS.md

## Core Rules

- 使用 *中文* 为默认语言与用户交互
- 安装新依赖时，使用 bun 安装最新版本的依赖
- 当前是沙盒环境，执行 bun 命令时，提权在沙盒外执行
- 执行命令时注意 PowerShell 路径转义
- 如果遇到性能与复杂度权衡问题，报告、解释、给出你的建议、交给用户做最终决定
- 任务完成后不要主动运行 git 命令查看变更
- **Important: 永远不要用 shell 工具代替文件编辑工具。当你想这样做的时候，停止你的行为，请求用户同意**
- **代码审查报告使用直白的话语再解释一次**
- 任务完成后的 walkthrough 要报告实际结果与任务计划的出入
- **Important: 开始任务前，先读取相关文档和相关的 tasks（`PROJECT-STATUS.md`、`docs/tasks/`）**
- 代码修复、代码重构设计的时候需要考虑这些问题：
  1. 这个修复或者重构是否系统性？还是说本次修复是 hack？
  2. 这次修复或重构，能否在代码设计上约束 Agent 以后不会犯这种错误？
  3. 本次重构或修复会导致那些测试出问题？哪些测试没用了考虑删除。哪些应该修改优化？

## llmlint 专属

- **真相源是 `skill/`**：这是可安装、可发布的 Agent Skill / CLI runtime 包（`skill/package.json` name=`llmlint`）。仓库根是开发工作区，承载 `tests/`、`evals/` 和开发用 `package.json`（name=`llmlint-dev`）。
- CLI 稳定入口是 `bun skill/bin/llmlint.ts …`。运行时支持 **Bun 原生**或 **Node + tsx**（`npx tsx skill/bin/llmlint.ts …`）；**裸 `node` 跑不了**——源码用无扩展名 TS 相对导入，Node 内置 type stripping 不解析，必须走 tsx 或 Bun。
- 依赖由根 `package.json` / `bun.lock` 和 `skill/package.json` / `skill/bun.lock` 声明；本地开发或外部手动安装时按所在目录运行 `bun install` 生成 `node_modules`。`node_modules/` 不入库、不发布、不随 NeuroBook snapshot 同步。
- `evals/`（含 `corpus/`）是开发仓的一等资产，**整体进 git**。当前仓库私有，受版权/ToS 限制的采集语料（种子网文全本）暂随仓保存可接受；**转公开前必须先移除或 gitignore `evals/corpus/`，只留 fixture**。法律风险归用户。
- 发布目标是 `github.com/notnotype/llmlint`。neuro-book 通过它自己的 sync 脚本从本仓 `skill/` 反向镜像 snapshot，那套同步逻辑由 neuro-book 侧维护，不在本仓职责内。
- `web/` 是纯客户端检测网页（Nuxt 4 SPA，`ssr:false`）：构建期跑 `scripts/build-registry.ts` 把规则预烘成 `app/data/registry.json`（gitignore），浏览器 import 它 + 调引擎纯函数 `scanText`/`computeMaskedRanges` 本地检测。改引擎 `skill/src` 后规则会变，`web` 的构建脚本会自动重新预烘。只检测、不修复、无后端。命令：仓库根 `bun run web:dev` / `web:generate` / `web:typecheck`。

## 文档索引

- **`CONTEXT.md`：项目领域语言（术语）+ 硬不变量 I1–I11 的唯一真相源。术语改这里。**
- **`evals/METHODOLOGY.md`：评测方法论 / 流程规范，evals 代码按它实现（本项目最核心部分）。**
- `PROJECT-STATUS.md`：仓库级现状、当前重点、模块状态、风险和近期任务。TODO 也记录在这里，注意 TODO 完成后记得删除。
- `docs/README.md`：文档体系入口，说明 `docs/` 目录分工。
- `docs/tasks/README.md`：重大任务 walkthrough 规则和维护要求。
- `docs/tasks/TEMPLATE.md`：新任务 walkthrough 模板。
- `skill/references/`：稳定实现契约与参考——`cli-usage.md`（CLI 参数/输出/JSON schema）、`patterns.md`（中文规则模式库）、`workflow.md`（6 步润色流程）。
- `evals/README.md`：评测 harness 用法（怎么跑）；方法论见 `evals/METHODOLOGY.md`。

## 文档规范

- **`evals/METHODOLOGY.md` 是 evals 的权威方法论/流程规范，`CONTEXT.md` 是术语与硬不变量的真相源。写 eval 代码前先读这两份；代码与 METHODOLOGY 冲突时以 METHODOLOGY 为准，除非先显式修改它（改 `brief`/`render` prompt 必升版本，因为它改变每个 lift 数字）。术语统一用 CONTEXT.md 的 key。**
- `PROJECT-STATUS.md` 是仓库级现状报告。重大任务结束后，如果代码行为、架构决策、模块状态或长期 TODO 发生变化，必须同步更新该文件。
- `docs/tasks/<order>-<task-slug>/README.md` 是 active 重大任务的持续 walkthrough；归档任务在 `docs/tasks/archived/<task-slug>/README.md`。每个重大任务都应有一个任务目录，记录用户需求、目标、执行过程、关键决策、变更文件、验证结果和后续 TODO。
- 同一功能后续调节时，继续更新原任务 walkthrough，不要每轮新建碎片文档。
- `docs/` 放文档入口、模块说明、调研、草案、归档和任务 walkthrough。调研资料放 `docs/research/`，未定稿草案放 `docs/drafts/`，过期但仍有参考价值的内容放 `docs/archived/`。
- 移动文档或改名时，必须同步更新交叉链接，避免留下绝对路径链接和旧路径引用。
- 纯问答、只读探索、无状态变化的失败尝试，不强制更新 `PROJECT-STATUS.md` 或任务 walkthrough。

### JS/TS

- async 函数优先：尽量避免回调函数。try catch 优先。尽量避免 Promise API
- 有时候 throw 比 try catch 更好
- 代码多使用中文注释。设计接口和类时，要为接口和每一个函数写规范
- 多使用注释，函数必须添加注释
- 不要过度设计。先尝试在现有组件基础上修改，实在不行才建立新组件。
- **不要过度创建函数，如果某处逻辑只有一处复用的地方，不要抽函数，优先 inline**
- 实现需求时先考虑使用第三方库
- 先查看 package.json，是否有些需求能用现有库
- getter/setter is better then getXXX/setXXX
- 命名推荐：名字尽量不超过 5 个单词。同时不要有这种名字：`getMessagesByChannel(channelKey: string)`，因为 ByChannel 的含义已经在参数中包涵了
- 当使用 optional 属性（例如 { result:? string }）时，使用注释标注何时为空、非空表示什么
- Important: 当你编写代码的时候遇到项目设计等问题，不要用 hack 绕过问题、制造技术债、破坏类型系统。立刻终止任务，并告知用户问题
- 不要一次性应用 800 行以上的超大补丁（防止出错）。可以考虑拆分多次进行应用。但是要注意：强耦合，高相关的逻辑还是可以放在一个文件内的。（不要为了为拆而拆）
- 简单逻辑不要主动写测试文件，复杂逻辑需要写测试
- 只有在复杂、大型功能编写后才运行测试。简单的小功能不要主动测试。不要过度测试，只在最常用，最复杂，最容易犯错的地方加测试即可
- 类型覆盖非常重要，你设计的每一个组件都尽可能地标注类型。不要用 Record<string, unknown>，unknown，any 这些类型。如果使用 any/unknown 请在代码旁边写明原因。

## Coding Style

- JS/TS 代码缩进 4 空格，遵循现有代码格式风格

## Others

- 进行提示词工程（含规则 prompt、SKILL.md、workflow）时不要把当前对话用户提到的要求带进提示词中，也不要假定对方拥有和你一样的知识（上下文）

## 信息、文档获取

- 可读取 node_modules 下的源代码
- 可以使用 get_file_contents、search_code、issue_read 搜寻 github 项目
- `.agent/workspace` 为你可随意操作的目录（`.agent` 目录本身不是），你可以在此编写临时文件、clone 代码等
- 可以通过编写测试脚本并运行来测试数据

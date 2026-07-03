# 文本润色 Skill 和 CLI 工具

> 来源说明：本任务在 llmlint 还内嵌于 neuro-book 时执行，是 llmlint 的历史源头（原名 `anti-ai-slop`）。原文中的调用路径已从内嵌 skill 路径改写为独立仓 `skill/` 路径；早期规格草稿（`.agent/workspace/*.md`）留在 neuro-book 历史，未迁入本仓。

## User Request / Topic

创建一个完整的文本润色 skill 系统，帮助润色中文文本，并识别和修复套路化表达、AI 写作痕迹与八股文风格。系统原名 `anti-ai-slop`，2026-06-28 硬切重命名为 `llmlint`。

**2026-06-14 update**：用户面表述从旧的风格清理心智收敛为“文本润色”；步骤 3 增加 stop-slop 风格的快速审查清单和 Directness / Rhythm / Trust / Authenticity / Density 五维 50 分评分；stop-slop 的核心规则已本地化注入 static rules、LLM rules 和 category suggestions。

**2026-06-28 update**：`anti-ai-slop` 硬切重命名为 `llmlint`，旧 skill key 不保留 alias；CLI 模块化为自包含 ESM package。

**2026-06-29 update**：llmlint 规则升级为 flat Rule Registry；当时默认规则包为 `builtin/anti-ai-slop` ruleset，配置改为 `rulesets` / `namespaces` / `rules` 三层覆盖。规则入口后续已收敛到 `builtin/default`。

**2026-06-29 update 2**：`旧中文规则样本目录` 的 11 个中文规则样本曾取精华策展合并为单一 `builtin/cn`。该入口后续已与人工规则合并到 `builtin/default`。

**2026-06-29 update 3**：默认规则入口收敛为单一 `builtin/default`，合并原人工 anti-ai-slop 规则与中文策展规则；中文规则 ID 从 hash 改为英文语义 slug，例如 `cn.vocabulary.body.skull-head`。

**2026-06-29 update 4**：硬切删除旧格式兼容字段和公开单文件导入入口；`旧中文规则样本目录` 只作为官方默认规则集的策展素材。

**2026-06-30 update**：`builtin/default` 规则资产硬切为 `rules/` 层级目录递归加载，`ruleset.json` 不再声明规则文件清单，也不兼容旧根 `rules.json`。

**核心需求**：
1. CLI 工具：类似 eslint 的文本检查器，输出问题列表
2. Agent Skill：完整的润色工作流程，包含 LLM 审查 + Web 调研 + 用户审批 + 自动修复
3. 规则系统：可扩展的规则库，支持 static（正则）和 llm（语境判断）两类规则

**后续计划**：
- 部署到网站，暴露给测试用户使用
- 收集用户数据来优化规则和助手
- 发展为完整的 AI 润色助手产品

## Goal

创建一个中文文本润色系统，验证点包括：

1. **CLI 工具可运行**：`bun skill/bin/llmlint.ts check <file>` 输出类似 eslint 的格式化报告
2. **规则系统可扩展**：JSON 格式的规则定义，static 和 llm 规则分离
3. **Skill 可执行**：Agent 能按 6 步流程完成润色任务
4. **修复结果正确**：能识别并修复典型套路化表达（填充词、机械过渡、二元对比、公式化设问、空泛总结、节奏单调等）

**约束（第一版）**：
- 保持简单，不使用 jieba/词性标注/句法分析
- 纯 TypeScript 实现，使用正则表达式
- 第一版不做自动多轮迭代（说明：语义修复由 Agent 执行；机械 `fix` 命令后续已在 Task 02 落地）

**使用范围**：
- 可读写 `skill/` 下所有文件
- 作为独立 CLI 使用
- 可调用 web 调研做事实核查

**迭代策略**：
- 先实现规则 JSON 文件（定义具体规则）
- 再实现 CLI 工具（llmlint package）
- 最后编写 SKILL.md（Agent 工作流程说明）
- 每个组件独立验证后再集成

**阻塞条件**：
如果遇到无法通过正则实现的规则、或性能问题，需要停止并报告。

## Current State

**阶段**：已实现，2026-06-28 完成 llmlint 系统化重构

**已完成**：
- ✅ 需求讨论和确认
- ✅ 技术方案选型（TypeScript + 正则，不用 jieba）
- ✅ 规则系统设计（static/llm 分层）
- ✅ CLI 输出格式设计（类似 eslint）
- ✅ 完整的 6 步润色流程设计
- ✅ 规格说明文档（早期草稿，归档于 neuro-book 历史）
- ✅ 规则 JSON 文件（rulesets/builtin/default/ruleset.json + rules/ 层级目录）
- ✅ CLI 检查工具（bin/llmlint.ts + src 模块）
- ✅ SKILL.md 和 reference 文档
- ✅ 2026-06-14：注入 stop-slop 本地化规则，新增快速审查评分流程
- ✅ 2026-06-14：验证 JSON 解析、CLI static 命中、LLM rule 输出和自然文本反向样例
- ✅ 2026-06-28：硬切重命名为 `llmlint`，不保留 `anti-ai-slop` skill alias
- ✅ 2026-06-28：新增 `package.json`、`llmlint.config.example.ts`、模块化 `src/`
- ✅ 2026-06-29：迁移为 flat Rule Registry，并最终收敛到默认 `builtin/default` ruleset
- ✅ 2026-06-29：策展合并中文规则样本，并最终收敛到默认 `builtin/default`
- ✅ 2026-06-29：默认入口合并为 `builtin/default`，中文规则 ID 改为语义 slug
- ✅ 2026-06-29：硬切删除旧格式兼容字段和公开单文件导入入口
- ✅ 2026-06-30：默认规则资产硬切为 `rules/` 层级目录递归加载

## Decisions / Discussion

### 2026-06-28 llmlint 系统化重构

**决策**：将系统 skill key 从 `anti-ai-slop` 硬切为 `llmlint`，不保留旧 alias。后续默认规则入口已进一步合并为 `builtin/default`。

**理由**：
- `llmlint` 更准确表达“像 eslint 一样规范 LLM 输出”的能力边界。
- 不保留双入口，避免 SkillCatalog 中长期出现两个候选，导致 Agent 选错旧 skill。
- 当前只有一个工具包，不做 monorepo；先在 skill 目录内按 ESM package 组织。

**变更**：
- 新入口：`skill/bin/llmlint.ts`。
- 规则最终收敛到 `rulesets/builtin/default/`。
- `llmlint.config.ts` 使用 `rulesets` / `namespaces` / `rules` 三层配置，支持 `off` / `warn` / `error` / `low` / `medium` / `high`。
- CLI 拆分为 config / rules / scanner / reporter / types / cli 模块，后续 Web 或编辑器复用时不需要解析命令行输出。

### 2026-06-14 文本润色升级

**决策**：保持名称、目录和 CLI 命令不变，将用户面表述收敛为“文本润色”。

**变更**：
- `SKILL.md` 的步骤 3 改为“LLM 深度审查 + 快速审查评分”。
- `references/workflow.md`、`references/patterns.md`、`references/cli-usage.md` 已同步为文本润色心智。
- `static-rules.json` 新增公式化设问、强调拐杖、负向列举、商务黑话、懒惰绝对词、金句式收束候选等规则。
- `llm-rules.json` 新增节奏单调、过度解释、缺少具体信息、隐藏行动者、金句感、段尾机械升华等语义规则。
- `category-suggestions.json` 新增对应坏例/好例和改写方向。

**验证**：
- JSON 三个规则文件均可被 `ConvertFrom-Json` 解析。
- `check` 样例命中填充词、二元对比、公式化设问、商务黑话、机械列举等新增规则，high 级别按预期返回 exit code 1。
- `show-llm-rules` 可输出 8 条 LLM rule。
- 自然小说段落反向样例输出 `✓ No problems found`。

### 1. 技术栈选择

**决策**：使用 TypeScript + 正则，不使用 jieba

**理由**：
- 第一版规则（填充词、机械过渡）用正则足够
- 避免引入额外依赖和复杂度
- 保持技术栈统一
- 性价比高（2-3 天可完成 MVP）

**排除方案**：
- ❌ Python + jieba：需要子进程调用，集成复杂
- ❌ 词性标注/句法分析：实现复杂，准确率提升有限

### 2. 规则分层设计

**决策**：规则分为 static 和 llm 两类，分文件存储

**Static Rules**：
- CLI 通过正则直接匹配，确定性高
- 包括：填充词、机械过渡词

**LLM Rules**：
- CLI 标记可疑位置，由 LLM 根据语境判断
- 包括：二元对比结构（"不是...而是..."）
- LLM 审查时只需读取这一类规则

**好处**：
- 职责清晰：CLI 做确定性检查，LLM 做语境判断
- 性能优化：LLM 不需要加载 static rules
- 易于扩展：添加新规则时不影响现有逻辑

（说明：static/llm 的分文件存储后续已在 Task 02 演进为 flat Rule Registry + `detector.type` 字段。）

### 3. CLI 输出格式

**决策**：类似 eslint 的命令行文本格式

**排除方案**：
- ❌ JSON：不直观，LLM 解析不友好（后续作为 `--format json` 可选项补上）
- ❌ Markdown：过于冗长，不适合命令行

**好处**：
- 开发者熟悉的格式
- 易于 LLM 解析
- 按类别分组，清晰易读
- 一类问题一个修复建议（不重复）

### 4. 修复建议粒度

**决策**：一类问题一个通用修复建议（避免每个命中都重复说明）。

### 5. 用户输入方式

**决策**：支持文件路径和直接粘贴文本

**实现**：
- 文件路径：直接使用
- 粘贴文本：写入 `.agent/polish-input.md`

### 6. 审批和输出方式

**审批**：
- Agent 自主选择审批方式（文本回复 or request_user_input）
- 用户可以回复"跳过第 3、5 项"等自然语言指令

**输出**：
- 生成新文件（`.agent/polish-output.md`），保留原文件不动
- 提供完整的修复报告

### 7. 第一版规则范围

**Static Rules（6 个）**：填充词（其实/实际上、值得注意的是、可以说、让我们）+ 机械列举（首先…其次…最后）+ 机械对比（一方面…另一方面）。

**LLM Rules（2 个）**：二元对比（不是…而是）+ 问题定义对比（问题/答案/关键 不是…是）。

**不包含（性价比低）**：排比结构检测、空洞表达检测、过度书面语检测（后续版本逐步补充）。

### 8. 迭代支持策略

**决策**：第一版不自动多轮迭代，但支持用户继续提修复（"第 12 行还是有问题" → Agent 读当前文件继续分析）。理由：避免无限循环、给用户控制权、降低首次实现复杂度。

## Verification / Test

### 1. CLI 工具测试

```bash
bun skill/bin/llmlint.ts check test-input.md
```
期望输出：按 high / medium / low 分段的问题列表，包含行列范围、规则、命中文本和修复建议。

测试文本（节选）应识别：填充词"其实"、填充词"值得注意的是"、机械列举结构、二元对比结构（需 LLM 判断）。

### 2. Skill 工作流程测试

完整润色流程：用户提供文本 → CLI 检查 → Agent 判断 LLM rules → 生成修复计划 → 用户确认 → 执行修复 → 展示报告。验证点：CLI 正确识别、LLM 正确判断"不是…而是"、修复建议合理、修改后文本正确、报告清晰。

### 3. 规则扩展测试

在规则文件添加新规则 → 重新运行 CLI → 验证新规则生效（无需改代码）。

### 4. 边界情况测试

空文件、超长文件（10000+ 行）、包含代码块的文本（不应检查代码块内容）、包含对话的文本（对话中的"其实"可能合理）。

## Implementation Walkthrough

### 阶段 1：规则定义 ✅

创建规则 JSON 文件。遇到问题：JSON 中的中文弯引号导致解析失败 → 全部替换为直角引号（「」）确保 JSON 有效。

### 阶段 2：CLI 工具实现 ✅

实现 checker（约 200 行）：用 `import.meta.dir` 获取脚本目录、`Bun.file().json()` 加载规则（避免编码问题）、按类别分组输出、类似 eslint 格式、`--min-level` 过滤、error 时退出码 1。

```bash
bun skill/bin/llmlint.ts check .agent/test-input.md
```

### 阶段 3：作为独立 CLI ⏸️

**决策**：作为独立 CLI 工具使用，Agent 用 bash 直接调用即可（参考其他独立 CLI skill 的模式）。

### 阶段 4：编写 SKILL.md ✅

面向 Agent 的命令式 6 步工作流程说明，含工具清单、规则清单、决策逻辑（何时自动修复、何时 LLM 判断、何时调用 researcher）。

### 阶段 5：创建参考文档 ✅

- `references/patterns.md`：中文 AI 味道模式库（约 250 行）
- `references/cli-usage.md`：CLI 工具使用说明（约 180 行）
- `references/workflow.md`：完整流程详解（约 400 行）

## 实现总结

### 已完成的产物

1. 规则文件（`rulesets/builtin/default/ruleset.json` + `rules/` 层级目录）
2. CLI 工具（`bin/llmlint.ts` + `src/` 模块，类似 eslint 输出）
3. Skill 定义（`SKILL.md`）
4. 参考文档（`references/patterns.md` / `cli-usage.md` / `workflow.md`）
5. 测试文件（`.agent/test-input.md`）

### 验证结果

```bash
bun skill/bin/llmlint.ts check .agent/test-input.md
```
成功检测 5 个填充短语、2 个机械过渡（1 error + 1 warning）、2 个二元对比（标记需 LLM 判断）；输出格式正确、退出码正确。

### 遇到的问题和解决方案

- **JSON 解析失败**：中文弯引号未转义 → 换直角引号。
- **路径解析错误**：SCRIPT_DIR 路径重复 → 用 `import.meta.dir`。
- **编码问题**：`readFileSync + JSON.parse` 偶发失败 → 用 `Bun.file().json()`。

### 技术亮点

纯 TypeScript + 正则（无 jieba）、规则与代码分离、分层检查（static + llm）、结构化输出（LLM 友好）、Agent 与用户各有文档。

### 性能数据

规则加载 < 10ms；文本扫描 ~1ms / 100 行；总耗时 < 100ms（1000 行以内）。

## TODO / Follow-ups

### 当前 MVP 范围（已完成）
- [x] 实现规则 JSON 文件
- [x] 实现 CLI 工具（llmlint package）
- [x] 编写 SKILL.md
- [x] 测试和验证
- [x] 2026-06-14：将用户面心智收敛为文本润色
- [x] 2026-06-14：注入 stop-slop 本地化规则
- [x] 2026-06-14：加入快速审查清单和 50 分评分
- [x] 2026-06-28：重命名为 llmlint 并硬切旧 skill key
- [x] 2026-06-28：改为自包含 ESM package
- [x] 2026-06-28：支持 `llmlint.config.ts` 规则覆盖
- [x] 2026-06-29：升级为 flat Rule Registry，加入 ruleset / namespace / rule 三层配置、override diagnostics、curated 默认规则集生成和 JSON 输出
- [x] 2026-06-29：策展合并中文规则样本，通过内部模块生成单一中文精选 ruleset
- [x] 2026-06-29：合并官方默认 ruleset 为 `builtin/default`，中文规则 ID 语义化
- [x] 2026-06-29：优化 CLI stylish 输出，按 high / medium / low 分段，默认紧凑显示行列范围和命中文本，并支持 `--min-level`
- [x] 2026-06-29：新增 `--show-lines`，小文件或人类阅读时显示完整命中行与 `<mark>`

### 后续增强
- [ ] 为快速审查评分沉淀更稳定的示例集
- [x] 支持完整命中行上下文
- [ ] 支持 namespace / rule 维度的临时 CLI 过滤
- [ ] 性能优化（大文件处理）

### 长期规划
- [ ] Web 版本部署（暴露给测试用户）
- [ ] 收集用户数据优化规则
- [ ] 支持风格自定义
- [ ] 支持特定领域（科幻、同人等）
- [ ] 排比结构检测、情感公式化检测
- [ ] 发展为完整的 AI 润色助手产品

> 后续的 flat Rule Registry、CLI UX、`fix` 机械修复、运行时收口见 [Task 02 llmlint Rule Registry](../02-llmlint-rule-registry/README.md)；评测体系见 [Task 03 llmlint Eval Harness](../03-llmlint-eval-harness/README.md)。

## References

- 早期规格草稿（规格说明 / 规则系统设计 / 实现难度分析 / 润色流程设计）：归档于 neuro-book 历史，未迁入本仓。
- stop-slop skill：neuro-book 历史参考。

# Task 23 分片 1 · A 线任务书：校准规则导入 + SKILL.md 提示词工程（本会话负责）

> 与 `PLAN-B-coding-handoff.md`（外部编码 Agent：handler 管线测试 / 用户状态层 / status·config / detect 命令）平行推进。
> 分工边界：A 线只动 `skill/rulesets/**`、`skill/src/namespaces.ts`、`skill/SKILL.md`、`skill/references/**`、校准测试文件、`docs/**`、`CONTEXT.md`、`PROJECT-STATUS.md`；**不动** `skill/src` 的引擎代码与 B 线新文件。
> 唯一预期交叉点：`skill/src/namespaces.ts`（A 线加策略表条目）——B 线任务书已声明不碰它。

## A1. 校准规则导入（原阶段 5）

全部规则 JSON 带 `source.importedFrom: "oh-story-claudecode/story-deslop"`（MIT，manifest 记 attribution），校准基线写进 `note`。severity 映射：blocking → `level:high, review:agent`；advisory → `level:medium|low`；高误杀（低连接/过度精炼等）→ `review:human`。

落位表（真相源：`rule-model-v3-design.md` §6 + `check-ai-patterns.js` 常量区）：

| 检测器 | 形态 | scope | 规则文件 |
|---|---|---|---|
| voice-contrast 音量反差 | regex | narrative | `rules/cliche/voice-contrast.json`（新 ns） |
| negation-parade ×2 否定排比 | regex | narrative | 并入 `rules/contrast/negative-listing.json` |
| reverse-not-is 反序对比 | regex（lookbehind 前字排除表） | narrative | 并入 `rules/contrast/binary.json` |
| trailer-ending 预告收尾 | regex | narrative + `position:{kind:"ending",chars:600}` | `rules/ending/trailer.json`（新 ns） |
| long-paragraph 长段落 | regex `[^\n]{200,}` | narrative | 并入 `rules/paragraph/split-long.json` |
| 工程词泄漏（细纲/情节点） | regex | all | `rules/mechanical/stage-leak.json` |
| 套词/比喻/解释链(core+buckets)/抽象总结/微动作 | density(doc) | narrative | `rules/cliche/…`、`rules/metaphor/…`、`rules/explanation/chain.json` 等 |
| action-list 动作清单 | density(paragraph) | narrative | `rules/rhythm/action-list.json` |
| notice-formality 公文腔 | density(paragraph) | dialogue | `rules/register/notice.json` |
| not-is / period-stutter / overcompressed / low-connective | handler 记录 ×4（builtin 名已注册） | —（handler 自管分层） | `rules/contrast/binary.json`、`rules/rhythm/…` |

配套：
- `skill/src/namespaces.ts`：新 namespace 策略条目 + 中文 alias（voice-contrast、ending.trailer、explanation.chain、rhythm.action-list、register.notice 等）。
- `skill/rulesets/builtin/default/ruleset.json`：manifest 增 MIT attribution 说明。
- em-dash 与既有 `punctuation.dash` 家族做差集核对（只补缺，不重复收）。

## A2. 校准测试矩阵（阶段 4 的规则侧遗留）

新建 `tests/calibration.test.ts`：把 `check-ai-patterns.js` 注释里的校准例句搬成用例矩阵——
- 真人 0 命中侧：`是的，他还记得`（确认语）、`不是A就是B`（either-or）、`还是/只是/但是…`（合成词前字）、`是不是`问句、`不是吗`反问、引号内台词、`正式拉开序幕`（报幕排除）；
- 必须命中侧：`不是A，而是B`、`不是A。是B`（跨空行揭示）、`声音不高，第一句却…`、否定排比双形态、`是真嗓子，不是修音修出来的`、章尾预告腔（position 窗口内）；
- 导入后回归：`bun skill/bin/llmlint.ts check` 对含校准例句的新 fixture 跑通——真人校准句 0 blocking、漏网例句全命中；`--review all` 确认落桶。

## A3. SKILL.md 五步流程 + 修复指导（原阶段 8 提示词工程面）

- `skill/SKILL.md` 改写为五步流程：
  ① `status` 初始化门（未初始化 → 询问用户共享档位/登录意愿 → `config set`；命令合同见 B 线任务书 §3.2）
  ② `check` + `detect` 双路检测
  ③ 合成报告：静态分级表 + 热区 + **四象限交叉**（规则密集×热力红=确认疑难；静默×红=新规则候选；密集×绿=误报候选；双绿=不打扰）
  ④ 修复↔复测一轮（沿用 polish-plan → 审批 → polish-output）
  ⑤ 疑难片段判定记 `.agent/llmlint-session.json` 台账 → 学习出口（本地 config 覆盖建议 diff；上传注明分片 2 提供）。
- 新建 `skill/references/repair-guide.md`：story-oracle 原则**提炼重述**（无 LICENSE，不搬原文）——三工序流水线、对白甲乙丙分类（拿不准归乙）、数据包腔例外；并入 story-deslop 的删除优先、删除比例上限、收敛终止纪律（MIT，可引）。
- `skill/references/cli-usage.md` 补新命令；`workflow.md`、`patterns.md` 同步 scope / density / ignoreTerms 的规则作者说明（含占位视图语义：narrative 规则不得依赖数句号）。
- 提示词纪律：不把本对话上下文带进提示词；不假定读者已知内部代号。

## A4. 文档回写

- `CONTEXT.md`：登记三条硬不变量——auto⇒scope 全域、未知 detector.type/handler 名优雅降级、narrative 占位视图语义。
- `PROJECT-STATUS.md`、本任务目录 `README.md` walkthrough（含与计划出入：阶段 1-4 实况、B 线拆分决策）。

## 依赖关系

- A1/A2 现在就能做（引擎面已就绪）。
- A3 的 ① 步文案依赖 B 线 `status`/`config` 命令落地后核对合同；可先写完再校对。

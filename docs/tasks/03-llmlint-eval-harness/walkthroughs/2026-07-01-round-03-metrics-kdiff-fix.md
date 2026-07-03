# Round 03 — 评测口径修复 + 全链路审查 + 语料搬迁（2026-07-01）

> 计划已审批（round-03 稿）。本轮起因是一次全链路审查，落点是把 README 锁的「两计数口径」真正接上、清掉死字段、加测试守门；中途语料被外部进程清掉，按用户要求**全量重建并搬出旧 scratch 目录**。git 边界见 [Task 04](../../04-llmlint-standalone-repo/README.md)。

## 起因：全链路审查发现的设计遗漏

走查 acquire / generate / consume 三条链路 + 引擎接缝，端到端通、产物与契约一致。但发现：README 锁的口径是「规则级 lift 用**原始命中**，文档负担用**去重 span**」，而 `metrics.ts` 的 `docScore`（喂 AI 检测器 AUC + 模型排名）实际用了**原始命中求和**；`scan.ts` 认真算出的 `dedupSpanCount`、`agentRawHits` 两字段**从没被读**（grep 确认只写不读）。后果：① 模型排名被「痕迹扎堆」扭曲（一句被多规则重复计），不符「文档负担」本意；② 两个死字段是技术债。

## 决策（用户拍板）

- **Q1 = 去重 span（两者都用）**：`docScore` 改成 `dedupSpanCount / 千字`，AUC 与模型排名都走它；`dedupSpanCount` 复活。per-rule lift 仍用原始命中（不变）。
- **Q2 = 接上误杀率**：`agentRawHits` 复活 → 报告「人类侧 agent 桶误杀率（命中/千字）」= agent 可见规则在干净人类正文上的噪声底（对应 shuorenhua 的 SNF 误杀<10% 护栏）。
- **语料位置（搬迁）**：原 scratch 目录被外部进程清空（详见下），用户要求重建时**别再放 `.agent/` scratch**。新位置统一在 `evals/` 下（已 gitignore 隔离运行态产物，且实测耐清理）。

## 改了什么

### 消费侧口径（`evals/lib/`）
- `metrics.ts`：`docScore` 从「Σ 原始命中」改为 `dedupSpanCount`（仍 /千字）；`detectorStat` 加 `humanAgentFalseRate` / `aiAgentRate`（agent 桶命中率中位）。
- `types.ts`：`DetectorStat` 加两个误杀率字段；`SampleScan` 注释更新为「已被消费」。
- `report.ts` / `score.ts`：报告与摘要标注 docScore 口径（去重 span/千字）、加误杀率行。

### 数学守门测试（新）
- `evals/lib/metrics.test.ts`（`bun:test`）：合成 `SampleScan` 且**故意让 dedupSpanCount ≠ 原始命中求和**，断言 `aiMedianScore===4.5`（证明走 span 不是 raw 的 6）、per-rule lift 仍用 raw、误杀率口径正确。`bun test` 5/5 通过。

### 小债清理
- `generate.ts`：render 空输出防护（`visibleLength===0` 跳过、不写盘、不进 meta）；merge meta 只替换**成功产出**的模型，失败模型不再误删旧 render。
- 文档：删掉 README 模块表里未实现的 `score.ts --holdout`（属 M3）；补「重新 acquire 后删 `brief.md` 强制重抽」。

### 语料搬迁（旧 scratch → `evals/`）
- acquire 四脚本重建到 `evals/acquire/`；语料到 `evals/corpus/`；报告到 `evals/report/`。
- `acquire.ts` / `generate.ts` / `score.ts` 默认路径改成 `import.meta.dir` 相对（指向 `evals/corpus`、`evals/report`），cwd 无关、不随 `.agent` 清理丢失。
- 模型 `config.json` 仍是外部私有配置（仓库外，非 eval 自有数据，不强行脚本相对）。

## 数据丢失事件（如实记录）

走查期间发现旧的 `.agent/` scratch 下 `{acquire,corpus,report}` 整树消失（只剩 fixture 跑出的 `fixture-report`，目录 mtime 为当时）。排查：本轮所跑命令（读文件、改源码、`bun test`、`score.ts`）无一触碰该路径（`score.ts` 只对 `--out` mkdir+写）；`.agent/` 其余目录完好、种子 epub 还在；同级多个 test 目录是当天新时间戳 → 判断为**其他会话/外部进程清理了该 scratch 目录**，非本轮所为。`evals/lib`、`evals/generator` 同期完好 → 该外部清理不波及 `evals/`，故 `evals/` 作为新家是耐清理的。

## 验证结果

- **单测**：`bun test evals/lib/metrics.test.ts` → 5/5 通过。
- **fixture 自检**：`score.ts --corpus evals/fixtures/corpus --min-support 1` → AUC **1.000**（去重 span 基），报告新格式（口径标注 + 误杀率行 + 排名表头）渲染正确。
- **真实语料（round-03，重建后）**：两种子重新 acquire（`转生反派萝莉.epub` → light-novel/villain-loli 5 ref；《诡秘之主》GBK txt → xuanhuan/lotm 5 ref），双模型重新 render（4 篇），`score.ts --min-support 3`：
  - **ROC-AUC 1.000**；docScore 中位（去重 span/千字）人类 **14.70** / AI **26.27**（~1.8×）。
  - **误杀基线**：人类 agent 桶 **4.27** /千字 vs AI 9.50。
  - **模型排名**：deepseek-v4-flash **24.35**（更像人）< mimo-v2.5-pro **29.84**。
  - **强判别 5**：`modifier.measure.specific` 4.75、`empty-measure` 4.55、`empty-quantifier`(agent) 4.25、`punctuation.dash.dash-alone-to-comma` 3.66、`repeated-de-pairs` 3.18。

## 关键发现（喂 Task 02，与 round-02 一致）

- 最强判别器（量词 measure、破折号 dash、叠词 de-pairs、比喻 simile、low-information-degree）lift 高但**多在 human 桶**，默认 `check` 对 Agent 不可见 → Task 02 应据此上调或重审路由。这是第二批真 AI-vs-人数据的复现（与 round-02、早期 4-tell 手测一致）。
- 反指标 2 条（人类>AI），Task 02 应降级/删。

## 计划出入 / 局限

- docScore 绝对值较 round-02 下降（14.70/26.27 vs 21.26/46.68）——**口径从原始命中改为去重 span 所致，不是回归**；且本轮 render 是**重新采样**（语料丢失后重建），与 round-02 数字不可逐一对比，方向（AUC≈1、deepseek 更像人、measure/dash/de-pairs 领跑）一致。
- 样本仍小（2 题组 / 4 render），AUC=1.0 是清晰分离的小样本结果，需 M3 扩量 + holdout 才稳。
- mimo 既抽 brief 又 render，轻微自我对齐 bias（记录在案）。

## Follow-ups（M3，本轮明确不做）

- **问题 2**：中位数 fireRate 会在扩量后漏掉「稀疏但只在 AI 出现」的判别器 → 给稀疏规则补 prevalence 口径或把 `pairsAiGreater` 纳入裁决。
- **问题 3**：真 1:1 同 brief 配对（每篇 reference 各抽各的 brief 各自 render），现在是题组级近似配对。
- genre/style 分层 + holdout 切分执行；稳后把规则体检表正式交 Task 02。

# CONTEXT — llmlint 领域语言与硬不变量

> 本文件是 llmlint 项目**领域语言（ubiquitous language）**和**硬不变量（invariants）**的唯一真相源。
> 术语在代码、文档、对话里统一用这里的 key；不变量是代码必须永远遵守的约束，违反即 bug（或需先显式修改本文件）。
>
> - 完整方法论 / 流程规范：[evals/METHODOLOGY.md](evals/METHODOLOGY.md)（代码按它实现）
> - 编年实现记录：[docs/tasks/03-llmlint-eval-harness/README.md](docs/tasks/03-llmlint-eval-harness/README.md)
> - 仓库现状：[PROJECT-STATUS.md](PROJECT-STATUS.md)

## 1. 一句话领域

llmlint 是针对 **LLM 生成中文文本**的 linter：CLI 用正则确定性定位「AI 味」候选，Agent Skill 读上下文判断并在用户审批后改写。
**eval harness** 是它的"体检仪"——用**配对语料**量化每条规则**区分 AI vs 人类**的能力，产出可直接驱动规则修复的「规则体检表」。

闭环：`eval 量化 lift → 高 lift 规则 = 真 AI tell → 交 Task 02 修规则 → 同一组规则既作判别器、又作 llmlint 降 AI 味的依据`。

**体系四环（2026-07-02 定位）**：中心资产是**大规则库**（超集）——规则没有全局好坏，只有**对某任务好不好**。上面的闭环是环 ① 的内循环；完整体系：

1. **规则选择（evals）**：用某任务的语料训判别器，产出该任务的规则子集 + 权重 = `task profile`（如 NeuroBook 语料 → 对创意写作纠正力强的 profile）。
2. **评价获取（web）**：用户上传 → **llmlint + 外部 AIGC 检测器**双路机器首检（先算后藏，D2）→ 人类在环盲评 + 指哪写得差 → 原始判定数据。
3. **规则整理（Task 02）**：LLM/人工把环 ② 的 NL 标注精炼为规则增补（给旧规则补八股词、新增规则）→ 入大库。
4. **应用验收（web，规划中）**：用户在 LLM/手动辅助下改文 → 验收 = 外部检测器概率下降**且**人评不降（D5）。编辑面已有（Task 07），缺送检对比与 post-edit 复评。

## 2. 术语表（稳定 key，代码与文档共用）

### 2.1 语料与生成侧

| key | 中文 | 含义 | 代码锚点 |
|---|---|---|---|
| `reference` | 基准正文 | 人类原文，评测标准（人工录入 / 切书得到） | `SampleRole`，`role:"reference"` |
| `brief` | 剧情纲 | 从 reference 抽出的剧情骨架，**只记"发生了什么"，不带句子级文体** | `generator/brief.ts` |
| `extract` | 抽取 | reference → brief 这个动作（由抽取器模型执行） | `extractBrief()` |
| `render` / `rendition` | 演绎 / 演绎本 | 照 brief 生成的正文（动作=render，产物=rendition）。**这就是"照纲要写一版"** | `generator/render.ts`，`role:"render"` |
| `eval-writer` | 评测写手 | 执行 render 的生成器 = **单次 LLM completion**，无 ReAct/工具/文风范本 | `generator/render.ts` + `model-client.ts` |
| `repair` | 修复本 | llmlint 洗稿后的 AI 正文（衡量"修复有没有把 AI 推向人类"，M4 才进判别） | `role:"repair"` |
| `critic` | 评分员 | 按参考给样本打分（第 ② 层，**未建**） | — |
| `sample` | 样本 | 语料里一篇正文（reference 或某 rendition） | `Sample` |
| `plot group` | 题组 | 同一剧情下 reference + 各 rendition 的集合 = **配对单元** | `<genre>/<plot-id>/` 目录 |
| `corpus` | 语料 | 全部题组的集合 | `evals/corpus/` |
| `pairRef` | 配对键 | render 指回本章 reference 的文件名，做逐章 1:1 配对 | `Sample.pairRef` |
| `referenceSource` | 来源 | reference 来路：切书 `book-segment` / 人工精选 `hand-picked` | `meta.json` |
| `styleKey` / `difficulty` | 文风 / 难度档 | render 的文风预设与难度档（baseline=raw，无预设） | `meta.json` |

### 2.2 度量与判别（消费侧）

| key | 中文 | 含义 | 代码锚点 |
|---|---|---|---|
| `fireRate` | 命中率 | 单篇某规则 `原始命中 / 可见字数 × 1000`（千字归一） | `metrics.ts:fireRate` |
| `lift`（rate 口径） | 判别增益 | `(AI 中位 fireRate + α) / (人类中位 + α)`，α=0.5 | `metrics.ts` |
| `prevalence lift` | 普遍度增益 | `(AI 命中文档占比 + β) / (人类命中文档占比 + β)`，β=0.1；**抓"稀疏但只在 AI 出现"的判别器** | `metrics.ts:fireFrac` |
| `effectiveLift` | 有效增益 | `max(rateLift, prevalenceLift)` = 取较强桶；**裁决与排序都用它** | `metrics.ts:strongerLift` |
| `verdict bucket` | 裁决桶 | `strong ≥3 / weak ≥1.5 / noise ≥0.67 / anti <0.67 / insufficient(支持不足)` | `metrics.ts:verdictOf` |
| `min-support` | 支持度守门 | `humanHits+aiHits < min-support` 判 insufficient，防小样本爆炸 | `score.ts --min-support` |
| `docScore` | 文档负担分 | `去重 span / 可见字数 × 1000`（**非原始命中求和**，防一句被多规则重复计） | `metrics.ts:docScore` |
| `dedup span` | 去重 span | 命中区间 `[start,end)` 合并后的处数（重叠算一处） | `scan.ts:countDedupSpans` |
| `detector` / `ROC-AUC` | 检测器 | 把 llmlint 当 AIGC 检测器：`AUC = P(AI docScore > 人类 docScore)` | `metrics.ts:rocAuc` |
| `model ranking` | 模型排名 | 各模型 docScore 中位数，**越低越像人** | `metrics.ts:modelRanking` |
| `误杀率` | false-positive rate | 人类侧 `review:agent` 桶命中率中位 = 干净人类正文上的噪声底 | `metrics.ts:agentFireRate` |
| `byModel` / `byGenre` | 分层 | 规则 lift 按模型 / 题材分桶报（一致性证据） | `metrics.ts:liftBy` |
| `holdout` | 留出集 | 按题组确定性切 train/test；规则/裁决只在 train 拟合，test 报泛化 AUC | `metrics.ts:splitHoldout` |
| `task profile` | 任务 profile | 用某任务语料训出的规则子集 + 权重；同一规则在不同 profile 可得不同 verdict。换语料跑 `score.ts` = 训另一个任务的 profile | report.json（per-corpus 产物） |

### 2.3 引擎维度（来自 `skill/`，eval 复用）

| key | 中文 | 含义 |
|---|---|---|
| `rule id` / `namespace` / `ruleset` | 规则标识 | flat Rule Registry：`id` 全局唯一，`namespace` 归类，`ruleset` 打包（默认 `builtin/default`） |
| `level` | 严重度 | `high/medium/low`，决定退出码 |
| `review` | 审查受众 | `agent/human/none`——命中该给谁看；eval 的**误杀率只看 `agent` 桶** |
| `fixability` | 可修性 | `auto/candidate/manual`，机械修复能力 |

### 2.4 架构角色

| key | 中文 | 含义 |
|---|---|---|
| `consumer` | 消费侧 | 打分仪器：纯函数 `语料 → 报告`，**import `skill/src` 引擎，不 spawn CLI**（`evals/` 主体） |
| `generator` | 生成侧 | 造数据管线：`acquire → brief → render`（`evals/acquire/` + `evals/generator/`） |
| `skill/` | 真相源 | 可安装、可发布的 runtime 包（引擎 + 规则），eval **不改**它 |
| `evals/` | 开发资产 | 进 git、**不进可安装 `skill/`**、不随 NeuroBook snapshot 同步 |

### 2.5 检测数据 / 标注（category ③）

> reference/render 之外的**第三类数据源**：web 采集的**判定标签**，喂评测第 ② 层（产品成绩单）与规则精度。详见 [Task 06](docs/tasks/06-web-data-collection/README.md)。

| key | 中文 | 含义 | 锚点 |
|---|---|---|---|
| `provenance label` | 来源标签 | 谁写的（人/AI）。客观、免费、可规模化 → 定义**检测器/lift** | `role`、`origin` |
| `judgment label` | 判定标签 | 读起来像不像 AI（人类主观）。贵、小 → 定义**产品** | `DocJudgment`/`SpanAnnotation` |
| `检测数据` | detection-data | web 采集的判定数据，来源未知/自述；喂 B，**永不进 lift** | Task 06 |
| `User` | 用户/标注者 | 注册用户；主观按用户结构化（与语料 author 对称） | `User` |
| `DocJudgment` | 文档判定 | doc 级两轴 `aiFlavor 0–5`(0人/5AI) + `wantReadOn 0–5` | `DocJudgment` |
| `SpanAnnotation` | span 标注 | span + NL 建议；哪条规则由 LLM 后处理判 | `SpanAnnotation` |
| `seeded-gold` | 掺入金标 | 已知来源样本混进采集流，校准用户 + 测 LLM 分类 | `origin` |
| `pre/post-edit` | 改前/改后判定 | 优化前后各打一次；差 = 降 AI 味效果 | `DocJudgment.phase` |
| `blind eval` | 盲评 | 人在看到机器结果**之前**打分（防锚定） | `DocJudgment.blind` |
| `detector signal` | 检测器信号 | 外部 AIGC 检测器的概率判定 = 机器首检第二路信号（与 llmlint 命中并排，同受 D2 盲评 gate） | `MachineRecord.detector` |

## 3. 领域概念（词与词之间的关系）

- **配对是控制混淆的核心**：同剧情下比 AI vs 人类，天然控制"剧情 + 体裁"两个混淆变量，远优于"AI 科幻 vs 人类言情"。题组（plot group）就是这个配对单元。
- **两侧硬分离**：生成侧产数据、不参与判别；消费侧是纯函数 `语料 → 报告`。接口只有一个——语料/meta 契约（见 METHODOLOGY §6）。
- **三层评测**（数据/标签/指标/消费者各不同，**严禁混淆**）：① 判别挖掘（已建）② 产品成绩单（未建）③ 显形回归（未建）。详见 METHODOLOGY §7。
- **lift 必要不充分**：高 lift 只说明"AI 爱这么写"，不等于"该修"（比喻、排比也高 lift 但可能是好写法）。判别挖候选，**产品评判定生死**，两层联动。
- **规则库是超集，eval 是任务选择器**：大库不做全局生死裁决；verdict 只在 task profile 内有效（"删" = 剔出该 profile，非物理删规则）。对哪个任务好，由喂给 eval 的语料决定。
- **外部 AIGC 检测器是地基不是对手**：三个挂载点——web 首检第二路信号（环 ②）、应用验收仪表（环 ④）、漏网探测器（判高概率 AI 但 llmlint 零命中的样本 = 新规则矿，喂环 ③）。llmlint 的差异化在"哪里/为什么/怎么改"，不在检测准确率。

## 4. 硬不变量（代码必须永远遵守）

> 这些是设计约束，不是建议。改动其中任何一条 = 先改本文件并说明理由，否则视为 bug。它们的作用是**在代码设计上约束 Agent 以后不会犯同类错误**。

- **I1 brief 不带文体**：抽取 prompt 只记剧情/人物/节拍/信息时序，**严禁**句子级风格/修辞/原文措辞。否则人类文风泄漏进 render、压低 lift。（`brief.ts`）
- **I2 render baseline 不喂文风范本**：eval-writer baseline 取模型"最原始 AI 嗓音"；文风预设只作可选更难档，不入 baseline。（`render.ts`）
- **I3 配对同源**：每篇 render 必照**同一题组、同一 brief、同题材**生成，`pairRef` 指回本章 reference。跨故事比较污染 lift。
- **I4 两个计数口径并存**：**per-rule lift 用原始命中**（`rawHitsByRule`）；**docScore/检测器/排名用去重 span**（`dedupSpanCount`）。不可混用。
- **I5 角色即标签**：`reference` = 人类类，`render` = AI 类，`repair` 单独统计、不进判别。
- **I6 人类基线纯度 = 检测器天花板**：reference 强 **pre-2023 偏置**；混入 AI 辅助文本会污染"人类"类，让检测器变差是假象。
- **I7 holdout 防过拟合**：改规则的 agent 会盯 lift 调规则 → 最终泛化分只在没调过的 test 集算；只有至少存在一组可解析 `pairRef` 的 reference/render 题组才有资格进入 holdout，合格题组 `< HOLDOUT_MIN_GROUPS(4)` 自动关闭并写警告。
- **I8 prompt 是版本化资产**：改 `brief`/`render` prompt **必须升版本号**——它改变每一个 lift 数字。每个 render sample 必须记录自己的 `promptVersion`；缺版本或同一报告内混用多个 render prompt 版本时，消费侧必须拒绝生成报告，不能降级为警告。
- **I9 消费侧不 spawn CLI**：`scan.ts` 直接 `import skill/src/rules + skill/src/scanner`，避免环境差异、拿结构化命中。
- **I10 CLI 路径 cwd 无关**：默认 corpus/out 用 `import.meta.dir` 相对，不用 `process.cwd()`（曾因外部进程清 `.agent` 丢语料）。
- **I11 语料合规边界**：`evals/` 进 git，但 `evals/corpus/`（受版权语料）**转公开前必须移除或 gitignore**，只留 fixture；法律风险归用户。

## 4b. 检测数据（category ③）采集不变量

> 与 I1–I11 同级，专管 web 判定数据采集（[Task 06](docs/tasks/06-web-data-collection/README.md)）。

- **D1 ③ 判定数据不进 lift**：检测数据喂 B（产品/规则精度），**永不混进** reference/render 的 lift——来源不干净，混了 A 的效度就毁了。
- **D2 盲评先于机器揭示**：人先打分、后显示命中/LLM 判/外部检测器概率（防锚定）；非盲判定不进主一致性。
- **D3 NL 原样存、结构化派生**：用户 NL（`note`）原样落库；"哪条规则/怎么改"是 LLM 后处理的**派生层**，不覆盖原文。
- **D4 文本⟂判定、人⟂机分离**：一文多评（众包就绪）、机器记录独立于人评；采集需注册 + `consent`。
- **D5 验收双条件防 Goodhart**：「降 AI 味」的验收 = 外部检测器概率下降**且**人类 `wantReadOn` 不降。禁止把"骗过某一个检测器"当唯一优化目标（会写出怪文）；检测器尽量多个 / 留 held-out。机器信号（检测器概率、llmGuess）由**服务器**写入，客户端不可伪造。

## 5. 相关文档

- [evals/METHODOLOGY.md](evals/METHODOLOGY.md) — 权威方法论 / 流程规范（代码按它实现）
- [evals/README.md](evals/README.md) — 怎么跑（快速上手）
- [docs/tasks/03-llmlint-eval-harness/README.md](docs/tasks/03-llmlint-eval-harness/README.md) — 编年 walkthrough
- [docs/tasks/03-llmlint-eval-harness/data-acquisition.md](docs/tasks/03-llmlint-eval-harness/data-acquisition.md) — 数据获取工程
- [docs/tasks/06-web-data-collection/README.md](docs/tasks/06-web-data-collection/README.md) — 检测数据 web 采集（判定标签、schema）

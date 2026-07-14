# 统一数据模型：参与者 × 文本 × 断言

> 本文是统一数据模型的**设计定稿**（评测语料 + web 采集共用一个概念模型），按 walkthrough 规则持续更新。
> 权威规范：[CONTEXT.md](../../../CONTEXT.md)（术语 + 不变量；本任务改写 §2.5 与 D1）、[evals/METHODOLOGY.md](../../../evals/METHODOLOGY.md)（§0 定位同步）。
> 建立在 [Task 09](../09-web-revision-persistence/README.md) 的 Revision 脊之上（不推翻，做增量）；重述并取代 [Task 06](../06-web-data-collection/README.md) 的「三类数据」框架。

## Relative documents refs

- [Task 09 web-revision-persistence](../09-web-revision-persistence/README.md) — Revision 谱系（本模型 lineage 的 web 实现，已落地）
- [Task 06 web-data-collection](../06-web-data-collection/README.md) — 旧「category ③」框架（被本模型吸收）
- [Task 08 eval-pipeline-hardening](../08-eval-pipeline-hardening/README.md) — reference/render 生成侧 + claude 隐身发现（本模型的直接动机之一）
- `web/prisma/schema.prisma` — 待增量迁移的持久层
- `evals/lib/corpus.ts` + `evals/corpus/*/meta.json` — 语料侧的既有序列化（格式不变，只加映射说明）

## User Request / Topic

用户在 Task 08 复盘后提出（2026-07-05/06 讨论）：

1. **reference+render 与 web 采集的数据是同一类**——我们收集的都是"参与者的数据"，reference+render 只是**让 LLM 扮演参与者**（量大、可信度低）。数据模型应统一，作为后续研究的基石：例如"对某题材某类用户偏好选规则" = 对统一数据的一次切片计算。
2. **列举了后续用途**（模型必须都装得下）：
   - 检测类：① 选规则（题材 × 用户群偏好 → task profile）② 训外部检测模型（AI/人二分）③ 训偏好打分模型（人类觉得好不好看）。
   - 优化类：读检测数据 → 指出哪里不好 →（AI 或人类）改稿 → 再检测 → 循环。两种可信档：web 人类改稿（人类监督，记人类）/ 纯 AI 改稿+打分（可信度低）。
   - 数据异质性：人类数据 ≠ 好数据（手选 reference 是好的人类文、用户也会传烂的人类文求优化）——**质量 ⊥ 来源**。
   - 未来采集模式：给用户两篇正文猜哪篇是 AI（+评论）——成对判定要能装进基础模型。
   - 检测器热力图（切片级 P(AI)）适合验证规则有效性；web 未支持、数据未采——**槽位现在留，采集后置**。
3. **对第一版设计的否决**（塑造了本定稿）：
   - ❌ 统一 Actor 运行时实体（userId 和检测器名混一个 id 空间、无实体信息）→ ✅ 各表用各自然键；
   - ❌ `subjects: TextId[]` 多态 Claim（约束弱、大量非法状态可表示）→ ✅ 按断言种类分表、成对判定独立两列；
   - ❌ `supervision` 标志 → ✅ 删除，**human 默认 = 人类+AI 协作**（即 Task 09 的 `user_fix` 语义）。

## Goal

> 把「评测语料」与「web 采集」收进**同一个概念数据模型**（参与者 × 文本 × 断言），并落成强类型 schema：**统一放概念层（文档叙事 + 闸门规则），运行时用分表强约束（非法状态不可表示）**。产出：① 本设计文档（概念模型 + 闸门 + 双侧映射）② web schema 增量（origin 三变体、MachineRecord 拆分、热力图槽位）③ CONTEXT §2.5/D1 与 METHODOLOGY §0/§7 同步。

## 概念模型（三句话，只进文档不进运行时）

1. **一切数据 = 参与者对文本的断言。** 参与者四种：人类用户 / LLM / 规则引擎 / 外部检测器。**reference+render 循环 = 让 LLM 扮演参与者**——换取样本量、付出可信度；web 循环收真人类参与者的数据，是真值源。
2. **质量 ⊥ 来源。** "谁写的"（provenance）和"写得好不好"（judgment）是两族正交标签；人写的可以烂、AI 写的可以被判想读。
3. **每个研究问题 = 一次切片查询。** task profile = 带 where 条件的 lift；偏好模型 = 人类判定表的全量；漏网矿 = 同一文本上 ground-truth 与机器判定打架的行。

运行时**不设** Actor 实体/统一 id：每张断言表用自己的自然键——人类 `userId`(FK→User)、LLM `modelKey`、引擎 `engineVersion`、检测器 `detectorName+detectorVersion`。类型即约束。

## Schema（web 侧，建立在 Task 09 现状上的增量）

### 已有且保留（Task 09 落地）

`User`、`Text`（文档信封）、`Revision`（不可变版本脊，`parentId`+`ordinal`+`transitionKind: upload|static_fix|llm_fix|user_fix`）、`DocJudgment`/`SpanAnnotation` 挂 revisionId。**revised 变体 = Revision 本身**，本模型不另造。`user_fix` 即"人类（含 AI 辅助）"，无需 supervision 字段。

### 增量 1：Text.origin 从两变体扩为三变体

```prisma
enum OriginKind {
  uploaded    // 用户上传：declaredProvenance（自述，不可信），consent/visibility
  curated     // 人工策展的人类正文（≙ 原 seeded_gold 之 human；provenance=human 是 ground-truth）
  generated   // 管线自产的 AI 正文（≙ 原 seeded_gold 之 ai；provenance=该 modelKey，ground-truth）
}
```

```prisma
model Text {
  id                 String      @id @default(cuid(2))
  genre              String?
  pov                String?
  textType           String?
  originKind         OriginKind  @default(uploaded)
  // —— uploaded 变体专属 ——
  declaredProvenance Provenance?         // 仅 uploaded 非空
  consent            Boolean     @default(false)
  visibility         Visibility  @default(private)
  // —— generated 变体专属 ——
  modelKey           String?             // 仅 generated 非空，如 "deepseek/deepseek-v4-flash"
  genParamsJson      String?             // 仅 generated：{briefVersion, renderPromptVersion, sourceRef?}
  // —— curated/generated 共用 ——
  sourceNote         String?             // 书名/章节/来处（curated 必填语义）
  // 导入者/上传者（所有权与级联；curated/generated 由 admin 导入）
  uploaderId         Int
  createdAt          DateTime    @default(now())
  ...
}
```

- **`goldProvenance`/`seeded_gold` 删除**：真值来源由 `originKind` 直接派生（curated⇒human、generated⇒该 modelKey）——少一个可能与 originKind 矛盾的字段，非法状态不可表示。
- zod 层用 discriminatedUnion 校验变体字段互斥（uploaded 不得带 modelKey 等）；prisma 层可空列 + 服务器强制（沿用 Task 06「origin 服务器设置、客户端不可伪造」不变量）。
- ⚠ I11 合规：curated 正文多为版权书选段，`visibility` 必须 private、绝不进公开池。

### 增量 2：MachineRecord 拆成两张机器断言表

现 `MachineRecord` 把扫描 + 检测器 + LLM 判混在一行且 `revisionId @unique`（每版只能测一次、存不下第二个检测器、没有热力图）。拆：

```prisma
// llmlint 引擎扫描（机器断言之一；仅服务器写）
model MachineScan {
  id            String   @id @default(cuid(2))
  revisionId    String
  engineVersion String
  hitsJson      String            // [{ruleId, span:{start,end}, level, review}]
  docScore      Float?            // 去重span/千字
  scannedAt     DateTime @default(now())
  revision      Revision @relation(fields: [revisionId], references: [id], onDelete: Cascade)
  @@unique([revisionId, engineVersion])   // 引擎升版可re-scan，历史保留
}

// 外部 AIGC 检测器（机器断言之二；含热力图槽位；仅服务器写）
model MachineDetect {
  id              String   @id @default(cuid(2))
  revisionId      String
  detectorName    String            // 如 "hf:yuchuantian-aigc-text-detector:predict_zh"
  detectorVersion String
  chunkChars      Int               // 分块口径（跨口径不可比）
  docPAi          Float             // 长度加权 mean P(AI)
  maxPAi          Float?
  chunksJson      String            // [{span:{start,end}, pAi}] ← 热力图（采集后置，槽位现在留）
  checkedAt       DateTime @default(now())
  revision        Revision @relation(fields: [revisionId], references: [id], onDelete: Cascade)
  @@unique([revisionId, detectorName, detectorVersion, chunkChars])
}
```

- 现 `llmAiFlavor/llmNote`（LLM 判 stub，无人写入）**删除**；LLM-as-judge 将来单开 `LlmJudgment` 表（见"后置"）。
- `blind` 派生规则更新：某 revision "已揭示" = 存在**任一** MachineScan 或 MachineDetect 且已展示给用户（D2 对两种机器断言同等生效）。

### 增量 3（规范先行、建表后置）

```prisma
// 成对判定："猜哪篇是 AI / 哪篇更好"。做该功能时建表，两列显式、不是数组。
model PairJudgment {
  id          String  @id @default(cuid(2))
  userId      Int
  revisionAId String
  revisionBId String
  question    String  // "which_is_ai" | "which_is_better"
  choice      String  // "a" | "b" | "unsure"
  comment     String?
  blind       Boolean @default(true)
  createdAt   DateTime @default(now())
  @@unique([userId, revisionAId, revisionBId, question])
}
```

> 成对判定给出的是**感知 provenance**——正好回答 claude 问题（人类是否也觉得 claude 像人），与机器判定、真值三方对照。**种子来源 = corpus 同 brief 的 reference×render 对**（ground-truth 已知，导入即 curated/generated 文本）——打标小游戏管线（METHODOLOGY §2.3）。

`LlmJudgment`（LLM 打分/判来源，机器断言之三，低可信预筛）同样规范先行、接入时建表。

### 增量 4：DocJudgment 增维（web 权威流程第 4 步，2026-07-06）

```prisma
model DocJudgment {
  // ...现有字段...
  improvementScore Int?     // 优化打分 0–5：这轮润色改得好不好。仅对有 parent 的 revision 有意义（rev0 恒 null）
  comment          String?  // doc 级自然语言评论反馈（原样存，D3；span 级仍走 SpanAnnotation）
}
```

- 复评（对修复稿的 DocJudgment）= AI味 + 想读 + **优化打分** + comment 四件套；盲评（rev0）只有前两轴。
- **众评**：`visibility=public` + 多人对同一 revision 各一条 DocJudgment（`@@unique(userId, revisionId)` 已支持）→ 一致性/共识/高分歧边界样本。

## 闸门（D1 的升级形态；每条 = 一行 where）

| 用途 | 准入 |
|---|---|
| **lift / 检测器训练 / task profile** | 文本 `originKind ∈ {curated, generated}`（ground-truth 来源；uploaded 自述永不进） |
| task profile 的切片 | 上行 ∩ `genre = X` ∩（可选）"被某用户群 DocJudgment 评过/评高" |
| 偏好/产品指标（想读模型） | `DocJudgment`（表本身即人类打分；blind 优先加权） |
| 规则精度 | `SpanAnnotation`/`PairJudgment` ⨝ `MachineScan.hits`（人机 span 对照） |
| 机器判定（Scan/Detect/LlmJudgment） | **永不当真值**——预筛、对照、漏网探测（检测器有 per-model 盲区，claude 实证）；真值 = 人类判定 |
| 优化循环有效性 | Revision 链两端 `MachineDetect.docPAi` 差 + `DocJudgment.wantReadOn` 不降（= D5 双条件按 revision 计） |

## evals 语料 ↔ 本模型的映射（格式不变，只立映射）

| corpus 事实 | 模型表达 |
|---|---|
| `meta.samples[role=reference]` + `reference-*.md` | Text{originKind=**curated**, sourceNote=书名/章} 的 rev0 |
| `meta.samples[role=render]` + `render-*.md` | Text{originKind=**generated**, modelKey, genParams={brief/render promptVersion}}；`pairRef` = genParams.sourceRef（指回 reference） |
| `meta.samples[role=repair]` | reference/render 的后继 Revision（transitionKind=llm_fix） |
| `evals/report/detector-scores.json` | MachineDetect 断言的文件序列化（chunks 即热力图，evals 侧已在收） |
| scan 结果（score.ts 内存中） | MachineScan 断言（evals 侧不落库，report.json 是聚合产物） |

corpus 文件格式**不改**；这张表的意义 = 两侧共用一个概念模型与准入闸门，跨侧分析（如"web 高分人类文 + corpus reference 合并算基线"）有了合法路径。

## 用途自查（用户列的每一条 → 模型如何支撑）

| 用途 | 支撑 |
|---|---|
| 一1 选规则（题材×用户偏好） | 闸门表第 2 行：带 where 的 lift = task profile |
| 一2 训 AI/人二分模型 | `originKind ∈ {curated,generated}` 全量（web+corpus 合并） |
| 一3 训偏好打分模型 | DocJudgment 全量（+blind 权重） |
| 二 优化循环（两种可信档） | Revision 链 + transitionKind（user_fix=人类档 / llm_fix=纯AI档）+ 链两端 DocJudgment/MachineDetect 差值 |
| 人类数据≠好数据 | 质量⊥来源：originKind 管来源、DocJudgment 管质量，互不混 |
| 猜哪篇是 AI | PairJudgment（感知 provenance，后置建表） |
| 热力图验证规则 | MachineDetect.chunksJson ⨝ MachineScan.hits 的 span 重叠（槽位已留，验证实验后置） |

## 实施切分

1. **本任务（设计+文档）**：本文档 + CONTEXT §2.5/D1 改写 + METHODOLOGY §0/§7 同步。✅ 本轮完成。
2. **web schema 增量迁移**（origin 三变体、去 goldProvenance、拆 MachineScan/MachineDetect）：归 web 线（Task 09 的后续阶段），趁数据仍近 0 迁移最省；迁移时同步 DTO/中间件/blind 派生。
3. **PairJudgment / LlmJudgment 建表**：随各自功能落地。
4. **闸门 helper 代码化**：web server 与 evals 各自一个 `liftAdmissible(text)` 纯函数（对齐本表），防实现者绕过。

## 文本分类方案（定稿并已实现 evals 侧，2026-07-06）

用户需求：两条采集线的文本都可由 LLM 做题材分类（**不强制**）；分类器做成**小型 agent**（工具即结构化出口，照 NeuroBook `report_result` 模式）；可配置；题材/体裁预先定好值集。

**已锁决策**：字段分工 题材=`genre` / 体裁=`textType` / 视角=`pov`（不加新字段）；优先级 **curator > user > llm，LLM 只补空不覆盖**；低置信（unknown）留空，白名单外的值丢弃告警（宁缺勿错——错值污染 byGenre 分层与 profile 切片）。

**实现（evals 侧，2026-07-06）**：

| 件 | 位置 | 说明 |
|---|---|---|
| 预定义值集 | `evals/lib/taxonomy.ts` | GENRES 13 值 / TEXT_TYPES 4 值 / POVS 4 值，**单一真相源**（render.ts 题材标签已收敛到此；web 可经 nuxt alias `evals` 引用） |
| 工具调用通道 | `generator/model-client.ts` | `callModelForTool`（gate+重试同一套）+ `classifyToolOutcome` 纯函数（ok=调了目标工具；散文回答→retry；CLI 通道→terminal） |
| 分类 agent | `evals/classifier/classify-agent.ts` | `report_classification` 工具（typebox 枚举白名单 + unknown）+ 自包含分类 prompt + `sanitizeClassification` 白名单校验 |
| CLI | `evals/classifier/classify.ts` | 遍历 corpus 补空（meta.classification 节：`{pov?, textType?, genre?, source:"llm", model, classifiedAt}`），幂等（已齐全跳过） |
| 配置 | `eval.config.classifier` | `{model, maxChars}`；须 HTTP 模型（CLI 无工具协议） |

**验证**：tsc 0；测试 115/115（新增 classifyToolOutcome×2 + sanitize×1）；**真跑 5 题组全中**——甄嬛传 pov=first、天龙八部 pov=omniscient（金庸全知✓）、其余 third，全 novel；重跑幂等（0 分类 5 跳过）。

**web 侧待接**（归 web 线，随 schema 增量迁移）：Text 加 `classifiedBy` 列；上传后服务器异步调同一 agent 补空（用户填的字段不覆盖）；taxonomy 从 `evals/lib/taxonomy.ts` import。

## TODO / Follow-ups

- [x] web schema 增量迁移 → 已由 [Task 13](../13-web-five-step-flow/README.md) W1 执行（2026-07-07）
- [x] 闸门 helper → [Task 13](../13-web-five-step-flow/README.md) W5：`evals/lib/gates.ts` + `web/server/utils/gates.ts` + export `liftAdmissible` 标记（含 rev_k≥1 不进 lift 的 revision 维度）
- [ ] 热力图：**采集已接**（[Task 13](../13-web-five-step-flow/README.md) W3，MachineDetect.chunksJson 真实落库）；规则×热力图 span 互证实验仍后置（用户明确后置）
- [ ] 成对判定功能 + PairJudgment 建表（后置）
- [ ] LLM-as-judge（LlmJudgment）接入（后置；只作预筛）

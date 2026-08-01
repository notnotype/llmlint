# 完整流程详解

本文档解释 `llmlint` 的依赖门、写作期入口和五步审稿闭环：安装依赖、初始化、双路检测、合成报告、修复复测、台账与学习出口。

## 流程概览

规则库有两个消费时机，写作期只有一步，审稿期是五步闭环：

```
写作期：install 依赖门 → guide [--tier] → 读或转交 markdown 约束（无需输入文件）

审稿期：install 依赖门 → status 初始化门 → check + detect
        → 静态分级表 + 两层检测结论 + 四象限 → 修复并复测一轮 → 台账 + 本地学习建议
```

## 写作期：动笔之前

```bash
bun "<skill-root>/bin/llmlint.ts" guide
```

档位由 `--tier` 控制，由窄到宽 `core < standard < wide < full`，缺省 `standard`。`core` 只有语义规则和有配对语料证据的规则；`full` 会带上全部逐词替换与定点删除词表，体积明显变大，用户明确要「全部」时才用。判别力档位需要外部 eval 报告，用 `--profile <report.json>` 传入。

**不是禁令清单**：某条写法在当前语境里承担剧情、人物声音、题材或载体功能时照写。写作期摘要也不替代成稿检查——写完仍然走下面的五步。

## 步骤 0：install 依赖门

优先把 SkillCatalog 提供的绝对 `root` 记为 `<skill-root>`；宿主只提供 `SKILL.md` 的绝对 `location` / source locator 时，使用其父目录。尖括号是占位符，执行前必须替换为实际绝对路径。首次使用当前 skill，或依赖合同更新导致 `node_modules` 缺失时，在任何 CLI 命令前运行：

```bash
bun install --cwd "<skill-root>" --frozen-lockfile
```

安装成功后才能执行 `status`；安装失败就停止并报告。依赖已经安装且依赖合同未更新时，不需要在每轮审稿前重复安装。

## 步骤 1：status 初始化门

先运行：

```bash
bun "<skill-root>/bin/llmlint.ts" status --format json
```

`status` 会报告版本、本地初始化状态、固定 `login:"none"`、共享设置、项目配置路径、检测器 space、代理状态和缓存目录。

这是软门，`initialized:false` 不阻塞 `check` / `detect`。

如果 `initialized:false`，读 `status` 报的实际档位，向用户说明四档各会**在本机攒下**什么（`off` 什么都不攒 / `stats` 只有命中统计与检测分数、不含文件名片段评语 / `fragments` 再加轮目录安全快照名、疑难片段原文与判定、修后评语 / `full` 再加修前修后全文，即在用户目录留一份正文副本）与 `sharing.mode` 的含义（`auto` 缺省，每轮收尾自动攒；`ask` 只列不写、要手动确认），再用 `config set` 写用户级 `settings.json`。只在用户要求改档位时才写 `sharing.tier`：

```bash
bun "<skill-root>/bin/llmlint.ts" config set sharing.tier stats
bun "<skill-root>/bin/llmlint.ts" config set initialized true
```

这句话只描述 `contribute`：本版本没有上传通道，记录只落在本机 `~/.llmlint/outbox/`。`detect` 是独立外部链路，会发送未缓存正文块；`sharing.off` 不会关闭它。

`config` 只管理用户级 `settings.json`，不会修改项目级 `llmlint.config.ts`。项目级规则变化必须以 diff 建议形式交用户审批。

初始化门之后、跑 `check` 之前还有两件事：

1. **问修前分**：「这稿你现在想继续读下去吗？0–5」，拒答记 null。放在 check 之前是刻意的——先看完命中报告再打分，分数会被报告带偏，修前修后的差值就失去意义。
2. **起一轮**：

```bash
bun "<skill-root>/bin/llmlint.ts" round begin <files...>
# 续修上一轮的修后稿时必须带父轮号
bun "<skill-root>/bin/llmlint.ts" round begin .agent/llmlint/rounds/0001/output/chapter.md --parent 1
```

它建 `.agent/llmlint/rounds/NNNN/`、把输入文件快照进 `source/`、在台账追加条目，并打印轮号与目录（下文记作 `<轮目录>`）。父轮必须显式声明：靠「内容变没变」推会在「第 1 轮审第 1 章、第 2 轮审第 2 章」时得出「用户中途手改过」的错误结论。另起一篇不传 `--parent`。

## 步骤 2：check + detect

静态检查。创作类正文（小说、散文、剧本）默认用 `--review all`，JSON 直接落进本轮目录：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --review all --format json > <轮目录>/check-source.json
```

非创作文本（技术文档、公告、说明）用默认 agent 桶：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --format json > <轮目录>/check-source.json
```

落盘后再读文件做步骤 3。命中数字不要抄进台账——`contribute` 直接从这份 JSON 统计，抄一遍只是多一次抄错的机会。

规则整理已把大量语境敏感规则下沉到 `human` 桶，创作类正文只看 agent 桶会漏掉主要问题（实测一篇 P(AI) 0.88 的轻小说，agent 桶 5 条命中、all 桶 43 条 + 1 条密度指纹，而最强的比喻密度指纹整体在 human 桶）。`agent` 桶是默认可修入口；`human` 桶参与四象限、密度判断和「问 / 留」分流，要修必须先取得用户同意。

`check --format json` 默认输出紧凑形态：规则元数据（含 resolved `scope`）在顶层 `rules`，命中只带 `ruleId`，`context` 裁到命中前后各 24 字。规则作者细节（`detector.targets` / `source` / `examples`）用 `--rule-detail`，体积大 4 倍以上，日常审稿不要用。

神经检测：

```bash
bun "<skill-root>/bin/llmlint.ts" detect <files...> --format json > <轮目录>/detect-source.json
```

`check` 会输出 regex、handler 和 density 的结构化命中。`detect` 会输出每个文件的 `docPAi`、`maxPAi`、`spread`、`cached`，以及逐 chunk 的 span、起始行、`pAi`、`rank`（文内 P(AI) 降序位次）和 `relative`（相对本篇均值的偏离）。`rank` / `relative` / `spread` 是报告层派生字段，不进缓存，所以 `cached:true` 时同样有。

缓存未命中的正文块会 POST 到配置的外部检测服务（默认 HF Space），请求不含文件名或项目路径。远端日志和保留策略不受 llmlint 控制；用户不希望正文离机时不要运行 `detect`。

网络失败时，不把整轮审稿判死。报告失败原因和代理建议：

```bash
bun "<skill-root>/bin/llmlint.ts" config set detector.proxy http://127.0.0.1:7890
```

## 步骤 3：合成报告

报告应面向用户，不直接贴原始 JSON。

### 静态分级表

按 `high / medium / low` 分层，再按 `review` 标记：

| 字段 | 用法 |
|---|---|
| `level` | 严重度与退出码口径。 |
| `review` | `agent` 默认处理；`human` 偏风格/高误杀；`none` 机械或诊断。 |
| `fixability` | `auto` 仅机械修复；`candidate/manual` 需要人或 Agent 判断。 |
| `densityIssues` | 分布指纹，一条代表全文或一段，不是逐处替换。 |
| `Issue.detail` | handler 动态说明，如连续短句数量或连接密度。 |

### 检测结论分两层

绝对阈值只用在整篇层。文内挑段落一律用相对排序——整篇 AI 生成的文本常常全部 chunk 都超过任何固定阈值，绝对判据在文内会把全文标红，失去分辨力。

| 层 | 判据 | 结论 |
|---|---|---|
| 整篇（绝对） | `docPAi >= 0.85` | 这篇整体可疑 / 不可疑。 |
| 文内（相对） | `chunks[].rank` 取两端，各 `ceil(chunk 数 / 4)` 个 | 本篇最可疑 / 最不可疑的段落。 |

```text
文内最可疑（rank 1–2 / 7）：
  L51-67  P(AI)=0.997  rank 1  Δ+0.122  预览文本...
文内最不可疑（rank 6–7，仍需看绝对 P(AI)）：
  L79-97  P(AI)=0.290  rank 7  Δ-0.586  预览文本...
```

不要把文内低位读成「检测器认为这段像人写」。实测一篇里 rank 6 的 chunk 仍有 `P(AI)=0.929`——它只是本篇里相对最低。

### 四象限

先用 `spread`（文内 P(AI) 极差）守门：

- **`spread < 0.15`：四象限对这篇不适用**。chunk 之间没有可分辨的高低差，两端之分只是噪声。报告「整篇均匀可疑（或均匀不可疑）」，改用规则信号密度排候选优先级。
- `spread >= 0.15`：按下表交叉。

0.15 是**未校准的起点**，不是定论：它只在一篇 `spread` 0.707 的样本上定过方向，那篇没有触及边界，后续需要在更多实测篇目上校准。`spread` 落在 0.1–0.2 之间时按两种读法都说明一遍，并以规则信号为主，不要靠这个数做二值切换。

| 规则信号 | 文内位次 | 处理 |
|---|---|---|
| 密集 | 高位 | 确认疑难。读上下文，优先交用户确认。 |
| 静默 | 高位 | 漏网新规则候选。记录片段和观察，不直接大改。**候选不等于规则**——从单篇读出的形态经常只是那一篇的特征，没在更大语料上验证过就不要写进 config。 |
| 密集 | 低位 | **规则与检测器分歧，需人工裁决。** |
| 静默 | 低位 | 不打扰。 |

「密集 × 低位」这一格特别容易误用。它**不能**直接推出「规则误报」：检测器本身会漏报，实测一篇 `P(AI)=0.290` 的 chunk 里 6 条命中经人工复核全部成立，包括「就像秋日的落叶一样平稳而自然，不带一丝波澜」这种典型模板比喻。要建议 `llmlint.config.ts` 覆盖，必须另有独立证据：同一规则在真人文本上反复命中，或按规则替换会损失原文信息。

### 语义规则审查

继续运行：

```bash
bun "<skill-root>/bin/llmlint.ts" rules --detector semantic
```

对无法静态定位的规则阅读全文判断。输出里的示例分两种：`命中例` 是该报的，`对照例（不该报）` 是形近但正当的写法，照它判断能少误报。没有候选也要在计划中说明“未发现明显问题”。

### 候选分流

每个候选都归入 **修 / 留 / 问**：确认无功能模板负担才修；承担剧情、人物、节奏、题材或载体功能则留；证据不足或可能改变作者意图则问。规则等级和文内位次决定审查优先级，不替代上下文判断。`human` 桶命中默认只进「留 / 问」。

## 步骤 4：修复并复测一轮

生成 `<轮目录>/plan.md`，等待用户审批。计划包含：

- 静态命中统计、两层检测结论，以及四象限摘要（`spread < 0.15` 时改为说明为何不适用）。
- 建议修复、建议保留、需要确认的项目。
- 每项的行号、原文片段、理由和拟改写。

修复默认写入 `<轮目录>/output/<原文件名>`。只有用户明确要求时才直接改原文件——即使直接改了，也要把改后内容拷一份进 `output/`，否则这一轮的谱系缺一半。计划写 `<轮目录>/plan.md`。轮目录互不覆盖，第二轮写进 `rounds/0002/`。

执行顺序固定为：先读上下文并确认功能，再按 **删 → 压 → 换** 做最小修改。不能用同义词轮换、模板身体反应、硬拆短句或新增细节来掩盖命中。

### 篇幅预算：删减不超过两成

`check` 报告的 `summary.visibleChars` 给出正文可见字数，与「/千字」同分母（跳过结构行与遮罩区）。修复前后各取一次，算删减比例；不要用 `wc` 等外部计数，它把标点空白也算进去，比例会失真。

删减接近或超过两成时**停下来向用户报告**，说明删掉的内容类别、理由，以及哪些可以恢复。这条护栏针对的是一个实测出来的失控模式：三种手法里「删」最容易累加失控——清单上每条单独看都该删，加起来能把一章削掉三分之一，而**静态命中与检测分数在这个过程中都在变好**，两个指标都不会报警。实测一次放开审批的修复把 4663 字改成 3003 字（−35.6%），同时命中 55→2、`docPAi` 0.947→0.597，人物地点道具全部保留、信息未丢——即使如此，这个幅度也该由用户决定而不是 Agent 自行决定。

### 复测

复测只跑一轮（创作类正文同样 `--review all`）：

```bash
bun "<skill-root>/bin/llmlint.ts" check <轮目录>/output/<原文件名> --review all --format json > <轮目录>/check-output.json
bun "<skill-root>/bin/llmlint.ts" detect <轮目录>/output/<原文件名> --format json > <轮目录>/detect-output.json
```

复测判据是三条同时成立：**静态命中减少、没有引入新命中、篇幅在原文 ±20% 以内**。第三条防的是靠删够多来清零命中——只有前两条时，把正文删薄就能满足它们。检测分数只作参考，不作目标。

实测证据：一篇 3131 字的 AI 生成轻小说，5 项修复后静态命中 43→38、high 1→0，但 `docPAi` 从 0.8757 **升到** 0.8844，承载其中 2 项改动的 chunk 从 0.929 升到 0.990。原因是「压缩抽象壳」的改写有时反而更贴近模型惯用表达。这与更早的配对实验一致（一轮修复规则分大降、神经检测器只动 0.7 个百分点）。

所以：看到分数没降不要再开一轮，也不要为了压分数改写更多句子。复测仍有高风险时报告剩余风险，不无限循环。

## 步骤 5：台账与学习出口

本轮条目在步骤 1 `round begin` 时已建好。这一步是**把它填完，不是追加新条目**：读 `.agent/llmlint/session.json`，找到 `round` 等于本轮轮号的那一项补字段，其余轮原样保留。

```json
{
    "version": 3,
    "projectId": "round begin 生成，不要改",
    "rounds": [
        {
            "round": 1,
            "parentRound": null,
            "startedAt": "round begin 写的，不要改",
            "completedAt": "",
            "status": "completed",
            "sourceFiles": [],
            "settings": {"sharingTier": "", "login": "none"},
            "summary": {"staticIssues": 0, "densityIssues": 0, "docPAi": 0, "spread": 0},
            "retest": {"staticIssues": 0, "densityIssues": 0, "docPAi": 0, "spread": 0, "verdict": "pass"},
            "decisions": [],
            "localConfigSuggestions": [],
            "judgment": {"wantReadOnBefore": null, "wantReadOnAfter": null, "comment": null, "blind": false},
            "contributedAt": null
        }
    ]
}
```

台账是唯一跨轮累积的沉淀：`decisions` 与 `localConfigSuggestions` 是学习出口的原料，覆写等于丢掉全部历史判断。过程产物（`plan.md` / `output/`）按轮存放，不再互相覆盖。

`summary` 与 `retest` 记 `docPAi` 与 `spread`，不记「热区数」——热区数依赖绝对阈值，跨篇不可比。**规则命中分布不写台账**，它在 `<轮目录>/check-source.json` 与 `check-output.json` 里，`contribute` 直接读那两个文件。

`judgment`：`wantReadOnBefore` 是步骤 1 问到的分；复测通过后再问一次同样的问题记 `wantReadOnAfter`，可顺带请用户留一句话记 `comment`。拒答记 null，不阻塞。`blind` 恒 `false` 且不要改——作者给自己的稿子打分不是盲评，如实标注才不会被将来的分析误用。

`decisions` 记录疑难片段：文件、行号、静态规则、文内位次证据、用户判定、保留/修复理由。`localConfigSuggestions` 记录建议的 `llmlint.config.ts` diff，例如：

- 某条误报规则：`rules: {"rule-id": "off"}`。
- 某类偏风格命中：`namespaces: {"punctuation.dash": {review: "human"}}`。
- 世界观术语：`ignoreTerms: ["仿佛山海"]`。

未经用户批准，不写项目配置。

台账填完后跑一次：

```bash
bun "<skill-root>/bin/llmlint.ts" contribute --auto --round <本轮轮号>
```

它按用户共享设置把本轮裁剪成一条自包含记录落进 `~/.llmlint/outbox/`。**只落本地，不联网、不发送。** 落不落由命令自己判并打印一行说明（`tier=off` 不做 / 未过初始化门不做 / `mode=ask` 只列不写 / `mode=auto` 直接写），把那行转达用户即可，不需要自己读设置分支。用户想看攒了什么用 `contribute --list`，删文件即撤回。

## 规则作者注意事项

- `scope.layer:"narrative"` 使用引号外等长占位视图；引号段被替成等长 `。`，offset 保持原文一致。不要写依赖“数句号”的 narrative regex。
- `scope.layer:"quoted"` 扫同一行内成对的 `「」`、`『』`、`“”`、`‘’`、`【】`（含分隔符）；ASCII 直引号、未闭合或跨行分隔符不进入 quoted。
- 省略 scope 归一为 `all`；一条规则只声明一个 layer，且项目配置不能覆盖。
- `density` 是分布问题；门槛是 AND 语义，命中后只能人工/Agent 修，不提供机械替换。
- `ignoreTerms` 是项目级豁免词；regex、density、handler 命中与豁免词区间重叠都会被丢弃。

## 修复原则

详见 [repair-guide.md](repair-guide.md)。简版：

1. 先删无信息负担，再重写必要句子。
2. 先判修 / 留 / 问，再按删 / 压 / 换处理；规则命中和 P(AI) 都不是修改命令。
3. 只改表达，不改剧情、人设和时间线；不能删除有功能的信息，也不新增原文没有的事件或细节。
4. 对白先分类，拿不准就交用户确认。
5. 系统公告和技术说明可以保留载体，但要避免叙述者变成说明书。
6. 不为清零命中或降低分数制造同义词套壳、模板反应和电报体。
7. 每轮有收敛边界，复测一轮后报告剩余风险。

---
name: llmlint
description: Lint and polish LLM-generated Chinese text by combining static rule hits, neural AIGC heatmaps, contextual review, approved repair, and local learning notes. Use when reviewing Markdown or plain text for AI writing tells, naturalness, repetitive patterns, lint rules, repair plans, or llmlint configuration.
---

# llmlint

llmlint 是面向 LLM 输出的文本 lint skill。CLI 负责稳定、可复现的候选定位与外部 AIGC 热力图；Agent 负责结合语境复核、制定修复计划、在用户审批后改写，并把疑难判断沉淀为本地学习出口。

目标不是把规则命中或 P(AI) 清零，而是在守住原文事实、剧情功能、角色声音和文体意图的前提下，减少无功能的模板负担。静态命中和检测热区都是候选证据，不是修改命令。

## Runtime

CLI 用 **Bun** 或 **Node + `tsx`** 运行。把 SkillCatalog 提供的绝对 `root` 记为 `<skill-root>`；若宿主 catalog 只提供 `SKILL.md` 的绝对 `location` / source locator，则使用其父目录。下文尖括号是占位符，执行前必须替换为实际绝对路径：

```bash
bun "<skill-root>/bin/llmlint.ts" <command>
```

裸 `node` 不能直接跑此 CLI。首次使用当前 skill，或依赖合同更新导致 `node_modules` 缺失时，必须先完成下方依赖门；不要先尝试 `status`，再等缺依赖报错。

## Dependency Gate + Five-Step Loop

### 0. install 依赖门

使用上面从 SkillCatalog 推导出的 `<skill-root>`。在第一次运行任何 llmlint CLI 命令前，必须执行一次：

```bash
bun install --cwd "<skill-root>" --frozen-lockfile
```

安装命令成功后才能进入 `status` 初始化门。依赖已经安装且 skill 未更新时不要每轮重复安装；安装失败时停止本轮 llmlint 流程并向用户报告，不要绕过依赖门改用其它包管理器或让 Bun 隐式补包。

### 1. status 初始化门

每次开始正式审稿前先运行：

```bash
bun "<skill-root>/bin/llmlint.ts" status --format json
```

读取这些字段：
- `initialized`：是否完成本地初始化。
- `login`：当前固定为 `"none"`；本版本不实现登录。
- `sharing`：用户共享档位与自动/询问策略。
- `configPath`：项目级 `llmlint.config.ts` 路径；没有则为 `null`。
- `detector`：神经检测器 space、代理状态、缓存目录。

这是**软门**：`initialized:false` 不阻塞 `check` / `detect`。不要因为没初始化就停下不干活，按下面确认完档位继续本轮审稿即可。

如果 `initialized:false`：
1. 读 `status` 报的 `sharing` 实际值，向用户说明当前档位以及四档各会上传什么：
   - `off`：什么都不传。
   - `stats`：只传规则命中统计与检测分数，不含任何原文。
   - `fragments`：再加疑难片段的原文 span、用户判定和修复前后 diff。
   - `full`：再加全文修复谱系。
2. 说明 `sharing.mode`：`ask` 表示每次上传前都会询问，`auto` 表示不再询问。
3. 说明本版本没有登录（`login` 恒为 `none`），也还没有任何上传通道，所以档位现在不产生实际传输。
4. 用户确认后用用户级配置命令写入，不修改项目级 `llmlint.config.ts`。只在用户要求改档位时才写 `sharing.tier`：

```bash
bun "<skill-root>/bin/llmlint.ts" config set sharing.tier stats
bun "<skill-root>/bin/llmlint.ts" config set initialized true
```

可查看用户级设置：

```bash
bun "<skill-root>/bin/llmlint.ts" config get
bun "<skill-root>/bin/llmlint.ts" config get detector.proxy
```

`config` 只管理用户级 `settings.json`，不写项目级规则配置。需要调整规则时，由 Agent 生成 `llmlint.config.ts` diff，等待用户审批。

### 2. check + detect 双路检测

先跑静态检查。**创作类正文（小说、散文、剧本）默认用 `--review all`**：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --review all --format json
```

非创作文本（技术文档、公告、说明）用默认的 agent 桶就够：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --format json
```

为什么创作类要 `--review all`：默认 agent 桶只收「低误杀、可直接交 Agent 处理」的规则，规则整理已把大量语境敏感规则下沉到 human 桶。实测一篇 P(AI) 0.88 的轻小说，agent 桶只给 5 条命中，而这篇最强的 AI 味特征（比喻密度 19 处 / 10.25 每千字）整体在 human 桶——只看 agent 桶会漏掉本篇最该讨论的问题。

两个桶的用法不同，不要混：
- `agent` 桶是默认**可修**入口。
- `human` 桶参与四象限判断、密度判断和「问 / 留」分流，但默认不进「修」。要修 human 桶命中，必须先向用户说明理由并取得同意。

JSON 默认是紧凑形态：规则元数据在顶层 `rules`，命中只带 `ruleId`，`context` 裁到命中前后各 24 字。要看规则的 `detector.targets` / `source` / `scope` 才加 `--rule-detail`（体积大 4 倍以上，日常审稿别用）。

再跑神经检测：

```bash
bun "<skill-root>/bin/llmlint.ts" detect <files...> --format json
```

`detect` 使用默认 HF Space `yuchuantian-aigc-text-detector.hf.space`，按句界分块并缓存正文哈希。网络失败时报告失败原因和代理设置建议；已完成文件的缓存仍可保留。代理可配置：

```bash
bun "<skill-root>/bin/llmlint.ts" config set detector.proxy http://127.0.0.1:7890
```

静态命中不是判决，P(AI) 也不是单独裁决。二者都只是审稿证据。

### 3. 合成报告

把 `check` 与 `detect` 合成一个面向用户的审稿报告：

- 静态分级表：按 `high / medium / low` 和 `review` 桶列出规则命中。密度指纹单列一段，字段是 `hits`（总命中次数）、`perKilo`（每千可见字）、`samples`（去重样本）；handler 命中的动态计数在 `detail`。密度指纹是分布结论，一条代表全文或一段，不能当逐处替换指令。
- 检测结论分两层，不要混：
  - **整篇层（绝对）**：`docPAi >= 0.85` 才说「这篇整体可疑」。这是唯一使用绝对阈值的地方。
  - **文内层（相对）**：按 `chunks[].rank`（P(AI) 文内降序位次）取两端，各取 `ceil(chunk 数 / 4)` 个。`relative` 字段是该 chunk 相对本篇均值的偏离。
- 四象限有效性守门：先看 `spread`（文内 P(AI) 极差）。**`spread < 0.15` 时四象限对这篇不适用**——整篇 AI 生成的文本常常全部 chunk 都在 0.98 以上，此时「高位 / 低位」只是噪声。这种情况直接报告「整篇均匀可疑」，改用规则信号密度排候选优先级，不要硬套象限。
  - 0.15 这个数是**未校准的起点**：它只在一篇 `spread` 0.707 的样本上定过方向，那篇根本没触及边界。所以不要把它当硬判据——`spread` 落在 0.1–0.2 区间时，两种读法都要在报告里说明，并以规则信号为主。
- `spread >= 0.15` 时做四象限交叉：
  - 规则密集 × 文内高位：确认疑难，优先读上下文，必要时交用户判定。
  - 规则静默 × 文内高位：漏网新规则候选。记录片段和观察，不直接大改。
  - 规则密集 × 文内低位：**规则与检测器分歧，需人工裁决**。不要仅凭这一点就判定规则误报或建议关规则——文内低位不等于检测器认为它像人写（实测一篇里 rank 最低第二位的 chunk 仍有 P(AI) 0.929），而且检测器本身会漏报。要建议 `llmlint.config.ts` 覆盖，必须另有独立证据：同一规则在真人文本上反复命中，或按规则替换会损失原文信息。
  - 规则静默 × 文内低位：不打扰。
- LLM 语义规则：继续执行 `show-llm-rules`，主动阅读全文审查无法静态定位的问题。

每个候选必须归入三类之一：

- **修**：确认是无功能的模板负担，并给出最小改法。
- **留**：命中承担剧情、人物、节奏、题材或载体功能，说明保留理由。
- **问**：证据不足或修改会改变作者意图，把冲突点交给用户判断。

报告不要输出原始 JSON 给用户。只摘取必要行号、规则、文内位次和建议。

报一条命中要同时给出 `rules[ruleId].title`、原文实际 `match`，以及 `action`（替换类给目标词，删除类说明删什么）。只报 title 不够——同一条规则在不同位置命中的原文不同，读者要看到自己写的那个词才能判断。

### 4. 修复 ↔ 复测一轮

生成 `.agent/polish-plan.md`，内容包括：
- 统计摘要，以及四象限摘要（`spread < 0.15` 时改为说明为何不适用）。
- 明确建议修复、建议保留、需要用户确认的项目。
- 每项引用行号、原文片段、修复理由。

等待用户审批后执行修复。默认写入 `.agent/polish-output.md`，只有用户明确要求时才直接修改原文件。

`.agent/polish-plan.md` 与 `.agent/polish-output.md` 是**单槽过程产物**：每轮审稿都覆盖上一轮，不做归档。需要留存上一轮的计划或改稿，先提醒用户自行另存，不要默认保留。真正需要跨轮累积的是台账（见步骤 5）。

执行每项修复前先读命中前后文，确认它承担的信息、因果、视角和语气。按 **删 → 压 → 换** 处理：先删无信息负担；删后断裂则压缩重复说明；只有必要语义必须保留时才改写。改动限定到解决问题所需的最小范围，不整段重写无关内容。

修复完成后只复测一轮（创作类正文同样用 `--review all`）：

```bash
bun "<skill-root>/bin/llmlint.ts" check .agent/polish-output.md --review all --format json
bun "<skill-root>/bin/llmlint.ts" detect .agent/polish-output.md --format json
```

复测的判据是**静态命中是否减少、且没有引入新命中**。检测分数只作参考，不作目标：实测一轮修复后 `docPAi` 可能不降反升，改动最集中的 chunk 甚至升 6 个百分点——「压缩抽象壳」的改写有时更贴近模型惯用表达。看到分数没降不要再开一轮，也不要为了压分数改写更多句子。

如果复测仍有高风险问题，报告剩余风险，不无限循环。不要为了压低检测分数牺牲语义、角色声音或可读性。

### 5. 台账与学习出口

台账是唯一跨轮累积的产物。**先读 `.agent/llmlint-session.json`，把本轮作为一个新条目追加进 `rounds`，不要整体覆写**；文件不存在时才按下面的形状新建：

```json
{
    "version": 2,
    "rounds": [
        {
            "sourceFiles": [],
            "completedAt": "",
            "status": "completed",
            "settings": {
                "sharingTier": "",
                "login": "none"
            },
            "summary": {
                "staticIssues": 0,
                "densityIssues": 0,
                "docPAi": 0,
                "spread": 0
            },
            "retest": {
                "staticIssues": 0,
                "densityIssues": 0,
                "docPAi": 0,
                "spread": 0,
                "verdict": "pass"
            },
            "decisions": [],
            "localConfigSuggestions": []
        }
    ]
}
```

`decisions` 与 `localConfigSuggestions` 是学习出口的原料，被覆盖就等于丢掉全部历史判断，所以只能追加。同一篇正文重新审稿也追加新条目，靠 `sourceFiles` 与 `completedAt` 区分。

`settings.sharingTier` 写 `status` 报的实际值，不要写死。`summary` 与 `retest` 记 `docPAi` 与 `spread` 而不是「热区数」——热区数依赖绝对阈值，跨篇不可比。`retest.verdict` 写 `pass` / `fail`，判据见步骤 4。

疑难片段判定要记录：文件、行号、规则与文内位次证据、用户判定、保留或修复理由、建议的本地 config 覆盖。上传能力不在本版本实现；远端学习出口只说明“待后续 contributions 命令”。

本地学习出口只能给 diff 建议，例如关闭某条误报规则、把某 namespace 移到 human 桶、添加 `ignoreTerms`。未经用户批准，不写 `llmlint.config.ts`。

## Repair Discipline

修复时使用 [repair-guide.md](references/repair-guide.md)：
- 删除优先，先删无信息负担，再重写必要句子。
- 只改表达，不改剧情、人设和时间线；不能删除有功能的信息，也不新增原文没有的事件。
- 对白先分类：保留角色声音，拿不准归入需确认。
- 数据包腔、系统公告、技术说明可以保留载体，但不要让叙述者变成 API 文档。
- 不用同义词轮换、模板身体反应、硬拆短句或新增感官细节掩盖命中。
- 不追求零命中或更低检测分数；修后语义、角色声音和可读性优先。
- 每轮修复有收敛边界，不因检测分数继续无意义打磨。

## Rule Author Notes

- `scope.layer:"narrative"` 扫描的是引号外等长占位视图；引号段呈现为等长 `。`。规则不能依赖“数句号”判断。
- `scope.layer:"dialogue"` 扫描成对引号和 `【】` 面板内文本，适合公告/系统台词。
- `density` 表示分布指纹，命中一条代表全文或一段的统计结论，不能机械替换。
- `ignoreTerms` 是项目级白名单；命中与术语区间重叠会被三种 detector 统一跳过。

## References

- [CLI 详细使用说明](references/cli-usage.md)
- [中文文本润色模式库](references/patterns.md)
- [完整流程详解](references/workflow.md)
- [修复指导](references/repair-guide.md)

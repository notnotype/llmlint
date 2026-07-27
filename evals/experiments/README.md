# evals/experiments — 元评测

这里放**回答「某个做法有没有用」**的一次性实验，与 `evals/score.ts` 那条常规判别力流水线分开：常规流水线量的是「每条规则区分 AI 与人的能力」，实验量的是「我们对生成或修复做的某个改动，有没有让输出更好」。

产物不进主语料 `evals/corpus/`：主语料固定 `render-v1`，而实验通常要换 render prompt 版本，混进去会触发 I8 的版本混用守门（`assertRenderPromptVersion`）。

## guide-arm：写作期约束有没有用

**问题**：把规则库投影成动笔前的写作约束（`llmlint guide`）注入系统提示词，输出是不是真的少了 AI 痕迹？这是 `llmlint guide` 这个能力唯一的验收依据——在此之前没有任何证据表明注入规则能改善输出。

**设计**：同一批 brief 上跑两臂，唯一变量是系统提示词里有没有约束块。

- 两臂都用 `render-v2`。空约束时它与 `render-v1` **逐字节等价**（`generator/prompts.test.ts` 守），所以差异只剩注入这一件事。
- **对照臂现生成，不复用主语料的历史 render**：那批是几周前产出的，直接拿来当对照会把模型漂移混进结论。
- 逐 brief 逐模型**两臂紧挨着跑**，让限流抖动与服务端波动对两臂等量作用。
- brief 复用主语料已有的，不重抽——重抽会引入第二个变量（I3 配对同源）。

```bash
# 生成（可续跑：已存在的文件自动跳过，中断后重跑只补缺口）
bun evals/experiments/guide-arm.ts --models deepseek/deepseek-v4-flash --tier standard --profile evals/report/report.json
bun evals/experiments/guide-arm.ts --dry-run            # 只看将生成多少、不调模型

# 外部检测器打分（主指标的来源）
bun evals/detector/detect.ts --corpus evals/experiments/guide-arm --out evals/experiments/guide-arm-report

# 配对比较（--tier / --profile 必须与生成时一致，否则注入/留出集合对不上）
bun evals/experiments/guide-compare.ts --tier standard --profile evals/report/report.json \
    --detector evals/experiments/guide-arm-report/detector-scores.json
```

**指标分三层，不能混**：

| 层 | 指标 | 为什么 |
| --- | --- | --- |
| 主指标 | 外部 AIGC 检测器 docPAi | 与规则库完全独立，不受循环论证影响 |
| 主要佐证 | **留出规则**命中 / 千字 | 注入某档后档外规则也该跟着降；只有注入的那批降 = 模型只是躲开了被告知的词 |
| sanity | 注入规则命中、整体 docScore | **循环**：把 llmlint 的规则塞进提示词再用 llmlint 数命中，近乎同义反复。只用来确认注入确实生效 |

判读：

- 主指标降 **且** 留出规则降 → 有证据支持。
- 只有注入规则降、留出规则不降 → 表层规避，不要采纳。
- 主指标不降 → 无论 docScore 降多少都不构成证据。

**结果（2026-07-27，deepseek-v4-flash，26 对）**：

| 指标 | control | guide | 逐对差值中位 | 方向 | p |
| --- | --- | --- | --- | --- | --- |
| 外部检测器 docPAi（主指标） | 0.896 | 0.776 | −0.073 | 20/26 更低 | **0.009** |
| 留出规则命中 / 千字（主要佐证） | 7.994 | 7.014 | −1.433 | 20/26 更低 | **0.009** |
| 注入规则命中 / 千字（sanity） | 1.722 | 1.469 | +0.025 | 12/26 | 0.845 |
| docScore 去重 span / 千字 | 8.810 | 7.948 | −1.269 | 17/26 | 0.169 |
| 可见字数 | 4084.5 | 3929.5 | −89 | 15/26 | 0.557 |

人类参照（同题组 reference，26 篇）：留出规则 2.33 / 千字，docScore 2.47 / 千字。

按上面的判读口径：**主指标降 + 留出规则降 → 有证据支持**。前两行是预注册的主指标与佐证，不是从五行里挑出来的，所以不需要多重比较校正（按 Bonferroni α=0.01 也仍通过）。

最有信息量的是那条**不显著**的 sanity 行：注入规则命中几乎没动。如果模型只是躲开被告知的词，最该降的恰恰是它；它没降而档外 195 条和外部检测器都降了，这排除了「表层规避」这个主要替代解释。篇幅也没被压垮，说明约束没把模型逼成惜字如金。

**同期的反向观察**：把 skill 装进 `~/.claude/skills/` 用 `claude -p` 实测时，Opus 5 读了 `guide` 之后照样写出「不是A，是B」——而那条就在 guide 第 42 行。它与本实验不矛盾，但**两个变量同时不同**（本实验注入 system prompt + deepseek；实测是 tool result 上下文 + Opus 5），需要一轮三臂最小实验拆开。详见 `docs/tasks/23-skill-loop-and-service/README.md`。

**已知局限**（写进结论，不要略过）：

- **D5 只满足一半**。验收双条件是「检测概率下降 **且** 人评 `wantReadOn` 不降」；第 ② 层 critic 未建，人评拿不到，所以任何结论都是暂定的，不能据此宣布这个功能有效。
- **留出集合的耦合度**。`--tier standard` 注入 71 条、留出 195 条，而留出的大多是逐词替换类词表（`脊背→背`），与注入的结构类建议耦合较弱，降不降的信号偏钝。想要更硬的对照，可以把 66 条建议类规则随机对半分、注入一半留出一半——同类型同性质，留出半边该跟着降。那是机制实验，不是产品配置，另开一轮。
- **样本量**。`report()` 输出符号检验 p 值就是为了防止在十几对样本上过度解读方向；n=26 时大约要 18/26 才到 p<0.05。

## delivery-arm：约束放在哪里才起作用

**问题**：`guide-arm` 显示注入约束有效（主指标 p = 0.009），但把 skill 装进 `~/.claude/skills/` 用 `claude -p` 实测时，Opus 5 读了 `guide` 之后照样写出「不是A，是B」——那条就在 guide 第 42 行。两个实验有**两个变量同时不同**：

| | 投递方式 | 写作模型 |
| --- | --- | --- |
| guide-arm | system prompt | deepseek-v4-flash |
| skill 实测 | tool result 上下文 | Opus 5 |

所以无法判断失败该归给投递位置，还是归给「强模型本来就不需要」。这个实验固定模型，只动投递方式。

**三臂**（都是 claude CLI 的 Opus 5）：

| 臂 | 约束在哪 |
| --- | --- |
| `control` | 不给约束 |
| `sysprompt` | system prompt（`--append-system-prompt-file`） |
| `toolresult` | tool result——prompt 要求先跑 `llmlint guide` 再动笔，还原真实 skill 路径 |

设计要点：

- `sysprompt` 与 `toolresult` 的**约束正文完全相同**（同一次 `buildGuideText` 的输出），唯一差别是它进上下文的位置。这就是要测的那一个变量。
- **三臂的写作指令一律走 `--append-system-prompt-file`**，位置一致；user message 只放 brief（`toolresult` 臂额外前置一句取约束的指令）。否则「写作指令在哪」会变成第二个变量。
- `toolresult` 臂只给 `--allowedTools Bash`，它必须真的去跑 CLI 拿约束才算还原 skill 路径。跑没跑可以事后查 claude 的 session transcript。
- claude CLI 的 cwd 用系统临时目录：在仓内跑会让它自动发现 `AGENTS.md` / `CLAUDE.md`，把项目上下文混进写作任务。

```bash
# 生成（可续跑；--per-group 缺省 1，即每题组一章）
bun evals/experiments/delivery-arm.ts --profile evals/report/report.json
bun evals/experiments/delivery-arm.ts --dry-run

# 打分
bun evals/detector/detect.ts --corpus evals/experiments/delivery-arm --out evals/experiments/delivery-arm-report

# 三次两两比较（--arms 基线,处理）
for arms in control,sysprompt control,toolresult sysprompt,toolresult; do
    bun evals/experiments/guide-compare.ts --arm evals/experiments/delivery-arm --arms "$arms" \
        --tier standard --profile evals/report/report.json \
        --detector evals/experiments/delivery-arm-report/detector-scores.json
done
```

**判读**：

- `sysprompt` 明显优于 `toolresult` → 投递位置是主因，`guide` 在 Agent 宿主里需要换接入方式（不能只靠 Agent 跑一次 CLI 把输出读进上下文）。
- 两臂都不优于 `control` → 「强模型本来就不需要」，`guide` 的价值集中在弱模型，产品上应按模型分级建议。
- 两臂都优于 `control` 且彼此接近 → 投递位置不重要，skill 实测那次失败是单样本噪声。

**规模**：3 臂 × 15 章 = 45 次调用（`--per-group 3`，5 题组各 3 章；语料共 26 章可用）。脚本可续跑（已存在的文件跳过），扩到更多章是纯增量。

15 对时符号检验的可达 p：12/15 → 0.035，13/15 → 0.007。所以这个规模够做显著性结论，但只在效应明确时——效应量小的话 15 对仍然会给出「不显著」，那时该扩样本而不是改判读口径。

**结果（2026-07-27，claude-opus-5，15 对）**：

| 指标 | control | sysprompt | toolresult |
| --- | --- | --- | --- |
| 外部检测器 docPAi（主指标） | 0.241 | 0.230 | 0.149 |
| 留出规则命中 / 千字 | 4.696 | 3.071 | 4.804 |
| 注入规则命中 / 千字 | 1.105 | 0.301 | 1.601 |
| docScore 去重 span / 千字 | 5.349 | 3.462 | 6.138 |
| 可见字数 | 3098 | **2344** | 2980 |

逐对符号检验（负 = 处理臂更低）：

| 对比 | docPAi | 留出规则 | 注入规则 | docScore | 字数 |
| --- | --- | --- | --- | --- | --- |
| control → sysprompt | 9/15，p=0.607 | 11/15，p=0.118 | 11/14，p=0.057 | 12/15，p=0.035 | 13/15，**p=0.007** |
| control → toolresult | 12/15，p=0.035 | 7/15，p=1.000 | 8/15，p=1.000 | 7/15，p=1.000 | 8/15，p=1.000 |
| sysprompt → toolresult | 12/15，p=0.035 | 4/15，p=0.118 | 1/15，**p=0.001** | 1/15，**p=0.001** | 4/15，p=0.118 |

**多重比较**：这一轮有 3 个预注册对比 × 1 个主指标 = 3 个主要检验，Bonferroni α = 0.05/3 = 0.0167。两个 docPAi 的 p = 0.035 都**大于**该阈值，所以**主指标上没有任何对比在校正后显著**。规则侧 `sysprompt → toolresult` 的 p = 0.001 校正后仍然显著，但它是循环指标。

**结论：投递位置有影响，但主指标在这个模型上失去了分辨力，所以「有没有用」这一问在 Opus 5 上仍未定。**

1. **`sysprompt` 确实让模型更遵守约束**：注入规则命中中位 1.105 → 0.301，与 `toolresult` 直接比是 1/15、p = 0.001（校正后仍显著）。约束进 system prompt 比进 tool result 有效得多，这一半的假设成立。
2. **规则侧 `sysprompt` 朝人类基线移动**：docScore 5.349 → 3.462（12/15、p = 0.035），人类参照是 2.47。留出规则 4.696 → 3.071 同向（11/15、p = 0.118）。
3. **但主指标不显著，而这一次不能读成「无效」**：`control → sysprompt` 的 docPAi 是 9/15、p = 0.607。原因见下面的基线表——**Opus 5 的 docPAi 基线（0.227）已经低于人类 reference（0.285）**，指标没有下降空间。本文件那条「主指标不降 → 不构成证据」的口径隐含假设是主指标有分辨力；在贴地板的模型上它不成立，此时 docPAi 既不能证实也不能证伪。
4. **篇幅代价是真实的**：`sysprompt` 中位 2344 字 vs `control` 3098 字，13/15、p = 0.007。目标字数是人类原章长度（中位约 3099），`control` 基本达标而 `sysprompt` 欠 24%。这正是 guide 抬头那句「不要为了绕开清单牺牲语义或可读性」想防的过度规避，**没防住**。规则命中降了、篇幅也降了，到底是「变简洁」还是「被削薄」，只有 D5 第二条件能判——所以这一轮的净收益是**未知**，不是负。

`toolresult` 臂 docPAi 反而最低（0.149，对 control 12/15）校正后不显著，且它的规则侧同时是三臂最差，两者矛盾，按噪声处理不做解读。

### 模型基线参考（决定主指标在哪些模型上可用）

来自主语料 100 篇 render + 26 篇 reference（`evals/report/report.json` 的 `externalDetector.byModel` 与 `modelRanking`）：

| 模型 | 外部检测器 docPAi | llmlint docScore / 千字 |
| --- | --- | --- |
| elysiver-gemini/gemini-3.1-pro | 0.969 | 10.76 |
| deepseek/deepseek-v4-flash | 0.945 | 7.64 |
| anyrouter-codex/gpt-5.5 | 0.941 | 6.11 |
| xiaomi-token-plan-cn/mimo-v2.5-pro | 0.923 | 11.27 |
| anyrouter-claude/claude-opus-4-8 | **0.130** | 7.25 |
| anyrouter-claude/claude-fable-5 | **0.071** | 6.42 |
| **人类 reference** | **0.285** | **2.47** |

两件事从这张表读出来：

- **两个维度的排序不一致**。claude 系在 docPAi 上比人类还低，但规则侧仍是 6.4–7.25（人类 2.47），仍有 2.6 倍的模板负担。「躲过神经检测器」和「不写套路」是两回事，`guide` 与 `check` 分别对着这两件事。
- **主指标只在 docPAi 基线明显高于人类的模型上有分辨力**。gemini / deepseek / gpt-5.5 / mimo 都在 0.92+，`guide-arm` 在 deepseek 上能看到 0.896 → 0.776 正因如此。claude 系（含本轮 Opus 5）在地板上，测它们必须换主指标——候选是规则侧朝人类基线的距离，但那是循环指标，需要另设独立裁判（第 ② 层人评是唯一现成出口）。

**产品含义**：不应无条件推荐注入。docPAi 基线 0.9+ 的模型（deepseek / mimo / gemini / gpt 系）有实测或强预期的收益；claude 系在检测器维度已无空间，注入的净收益未知且有篇幅风险。这条线现在只有 deepseek 一个实证点，其余靠基线表推断。

**局限**：n=15；D5 第二条件仍拿不到，而这一轮恰恰出现篇幅显著缩短——最需要人评的正是这种情况；跨实验的模型比较不是配对设计，基线表来自主语料而非本实验语料。

## 语料合规

实验语料是本项目自产的 AI 正文，不含受版权保护的采集内容，随仓保存（与 `evals/corpus/` 的合规边界不同，见 I11）。

# Rule Curation Open Questions

> 目的：规则系统精简时，凡是我无法靠现有 eval / overlap / 许可边界直接判断的事项，先集中记录在这里，最后一次性交给用户拍板。

## 已按证据处理

- 2026-07-24：`cn.metaphor.inserted-simile-shell`、`cn.cliche.mid-sentence-summary`、手部泛白 / 嘴角弧度重复规则、氛围修饰、状态修饰、夸张比附和绝对判断修饰中的 100% active-to-active overlap 条目，已按“保留更宽 canonical、不物理删除资产”的策略默认关闭。
- 2026-07-24：`filler-can-say`、`filler-lets`、`emphasis-crutch`、`rhetorical-setup`、`inflation-marvel`、`transition-summary-conclude`、`assistant-comfort-pose` 和 `cn.cliche.body-reaction.controlling-gaze` 已转 `human`，不再进入默认 Agent 桶。
- 2026-07-24：宽泛低信号 regex 继续下沉：`filler-worth-noting`、`opening-cliche-announce`、`opening-cliche-moreover`、`transition-summary-essence`、`cn.action-expression.calm-voice-shell`、`cn.action-expression.scream-to-whimper`、`cn.action-expression.teasing-modifier`、`cn.cliche.baguwen.death-grip-adverb`、`cn.cliche.baguwen.extreme-degree`、`cn.cliche.quote-meta-*`、`cn.cliche.gaze-emotion-container`、`cn.cliche.teeth-clenched-speech`、`cn.cliche.trailing-callus-clause`、`cn.cliche.voice-emotion-container`、`cn.sentence.compound.ordinary-days-preface` 和 `cn.sentence.compound.single-negative-contrast` 已转 `human`。`opening.cliche` 家族与 `dated-opening` 已限制到叙述层文首窗口。
- 2026-07-24：素材通配符转换遗留已默认关闭：`cn.cliche.body-reaction.mouth-corner-lift-arc`、`cn.cliche.body-reaction.mouth-corner-smile-arc`、`cn.cliche.body-reaction.smile-arc-comma-marked`、`cn.cliche.body-reaction.smile-arc-marked`、7 条 `cn.metaphor.like.*` 占位比喻壳和 `cn.tone.tone-placeholder`。`cn.cliche.baguwen.white-knuckles` 因与 `cn.cliche.hand-color-clause` 典型同 span 重复也已默认关闭。裸词级 `拆解`、`甚至是`、`因为惯性`、`外壳` 已转 `human`。

## 待用户拍板

1. **story-oracle 来源与许可边界**
   - 当前仓库只有 `skill/references/repair-guide.md` 中已经重述过的 story-oracle 原则，没有可校验原始来源或 LICENSE。
   - 建议：继续只吸收原则，不搬原文、不按其原文新增具体规则；如果用户能提供合法来源和许可，再进入规则导入评估。

2. **ASCII 直引号是否纳入引号分域**
   - 当前 `ScanContext` 明确不配对 `"` / `'`，原因是中文正文里直引号无方向性，容易误配。
   - 新增 `story-deslop.quote-emphasis` 只消费现有中文成对引号：`「」` / `『』` / `“”` / `‘’` / `【】`。
   - 待确认：是否要为英文直引号另做保守状态机，或继续要求中文小说规则只处理成对中文引号。

3. **复读 / 截断退化检测是否进入 llmlint**
   - story-deslop 的 `check-degeneration.js` 包含复读打转、末尾截断、占位符、工程词泄漏。
   - 当前已吸收工程词泄漏；复读/截断更像生成器质量门或后处理守门，不一定属于“AI 味规则”默认集合。
   - 待确认：放入 builtin handler、仅作为 `detect/check` 之外的生成退化 smoke，还是暂不做。

4. **默认规则是否继续同步 creative overlap 抑制**
   - 本轮已把 creative profile 里稳定 overlap 的 8 条旧规则同步为默认 `enabled:false`，保留规则资产和用户显式开启能力。
   - 待确认：后续是否把这个作为规则整理常规策略：稳定重叠且有 canonical 替代时，默认关闭旧规则，但不物理删除。

5. **人工桶后的规则级例外是否要提回 Agent**
   - 本轮已把 `vocabulary.body`、`vocabulary.r18`、`vocabulary.academic-anatomy`、`color-description`、`sound.once`、`jargon.business`、`regex.advanced` 默认下沉 `human`；只把 `cn.regex.advanced.few-degree` 作为强信号例外保留 `agent`。
   - 待确认：是否把 `vocabulary.body.flesh-skin` / `back-spine` / `mouth-corner`、`sound.once.laugh-one-sound` 等 weak 但人类命中低的规则级例外提回 `agent`，还是继续把这些题材词表留给人工复核。

6. **LLM 金句感是否继续打扰 Agent**
    - 本轮已将宽泛 regex 入口继续下沉：`filler-worth-noting`、开场普通连接词、`transition-summary-essence` 和旧单层否定对比不再进入默认 Agent 桶。
    - 当前仍保留在 `agent` 的同类高语义规则主要是 LLM 版 `quotable-punchline`。因为它不是裸 regex，而是要求读上下文判断“是否只剩姿态”，我暂未机械下沉。
    - 待确认：LLM 版金句感是否继续作为默认 Agent 审查项，还是也转为 `human`。

7. **剩余 Agent 桶 insufficient 规则是否按策略统一下沉**
    - 当前仍保留在 `agent` 的 low-support 规则主要包括：`cn.action-expression.mouth-corner-arc`、`cn.cliche.hand-color-clause`、`cn.cliche.trailing-mouth-arc-clause`、`cn.cliche.trailing-sensory-clause` / `trailing-sound-clause`、`cn.cliche.baguwen.unquestionable-claim`、`inflation-novelty`，以及 story-deslop 的少量 high blocking 校准规则。
    - 我没有继续硬改的原因：story-deslop blocking 有独立真人校准来源；嘴角/手部/尾部分句/拔高规则虽 support 低，但和 repair-guide 的“身体模板、总结帽子、拔高姿态”原则一致，仍像 Agent 可处理的 AI 味候选。
    - 待确认：后续是否采用机械策略“verdict=insufficient 且无 blocking 校准来源 → 默认 `human`”，还是继续允许少量语义明确但样本支持不足的规则留在 `agent`。

8. **剩余 active overlap 的跨桶处理边界**
    - 复筛后仍有 `cn.cliche.vague-transition-phrase` ↔ `cn.modifier.stacked-degree-adverbs`、`cn.cliche.baguwen.vague-amount-noun` ↔ `cn.modifier.measure.specific-measure-word` 等 agent/human 跨桶 overlap，以及少量 human/human overlap。
    - 我没有继续硬改的原因：这些不是同一受众里的重复提示；关闭哪边会改变默认 Agent 入口或 `--review all` 人工清单的职责边界。
    - 待确认：跨桶 overlap 是否也按 canonical 默认关闭一侧，还是保留当前“Agent 高信号规则 + Human 词表规则”并存。

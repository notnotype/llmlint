# Rule Curation Open Questions

> 目的：规则系统精简时，凡是我无法靠现有 eval / overlap / 许可边界直接判断的事项，先集中记录在这里，最后一次性交给用户拍板。

## 已按证据处理

- 2026-07-24：`cn.metaphor.inserted-simile-shell`、`cn.cliche.mid-sentence-summary`、手部泛白 / 嘴角弧度重复规则、氛围修饰、状态修饰、夸张比附和绝对判断修饰中的 100% active-to-active overlap 条目，已按“保留更宽 canonical、不物理删除资产”的策略默认关闭。
- 2026-07-24：`filler-can-say`、`filler-lets`、`emphasis-crutch`、`rhetorical-setup`、`inflation-marvel`、`transition-summary-conclude`、`assistant-comfort-pose` 和 `cn.cliche.body-reaction.controlling-gaze` 已转 `human`，不再进入默认 Agent 桶。
- 2026-07-24：宽泛低信号 regex 继续下沉：`filler-worth-noting`、`opening-cliche-announce`、`opening-cliche-moreover`、`transition-summary-essence`、`cn.action-expression.calm-voice-shell`、`cn.action-expression.scream-to-whimper`、`cn.action-expression.teasing-modifier`、`cn.cliche.baguwen.death-grip-adverb`、`cn.cliche.baguwen.extreme-degree`、`cn.cliche.quote-meta-*`、`cn.cliche.gaze-emotion-container`、`cn.cliche.teeth-clenched-speech`、`cn.cliche.trailing-callus-clause`、`cn.cliche.voice-emotion-container`、`cn.sentence.compound.ordinary-days-preface` 和 `cn.sentence.compound.single-negative-contrast` 已转 `human`。`opening.cliche` 家族与 `dated-opening` 已限制到叙述层文首窗口。
- 2026-07-24：素材通配符转换遗留已默认关闭：`cn.cliche.body-reaction.mouth-corner-lift-arc`、`cn.cliche.body-reaction.mouth-corner-smile-arc`、`cn.cliche.body-reaction.smile-arc-comma-marked`、`cn.cliche.body-reaction.smile-arc-marked`、7 条 `cn.metaphor.like.*` 占位比喻壳和 `cn.tone.tone-placeholder`。`cn.cliche.baguwen.white-knuckles` 因与 `cn.cliche.hand-color-clause` 典型同 span 重复也已默认关闭。裸词级 `拆解`、`甚至是`、`因为惯性`、`外壳` 已转 `human`。
- 2026-07-24：`cn.regex.advanced.few-degree` 在扩充后的当前 dataset 中 reference 命中率高于 AI 文本，已撤回 Agent 例外并回到 `human`；detector 同时加 `(?![钟之])`，避免“过了几分钟 / 几分之一”被半截命中。
- 2026-07-24：`cn.cliche.vague-transition-phrase` 收窄：裸“近乎”在当前 reference 中有真实用法（如“近乎成本价”），默认 Agent 只保留“近乎于”和“取而代之的是”。
- 2026-07-24：跨规则重叠继续收窄：`cn.cliche.baguwen.unquestionable-claim` 排除后接“的/地”，带修饰用法交给 `cn.modifier.absolute-claim-modifier`；`cn.cliche.trailing-sensory-clause` 限制到叙述层，避免对白/系统面板误报；`story-deslop.negation-parade.repeated-none` 排除后接“只有/只是/只会”的场景，避免和 `story-deslop.negation-parade.only-turn` 同报。
- 2026-07-24：`cn.sentence.compound.contrastive-turn-preface` 已转 `human`。当前 dataset 中它会命中合法对白、设定解释和事实辨析；默认 Agent 继续依赖 story-deslop 的高信号否定对比/否定排比规则。
- 2026-07-24：`cn.action-expression.mouth-corner-arc` 已转 `human`。旧报告 verdict 为 insufficient，当前 dataset 只剩 1 个 AI 命中；默认 Agent 保留尾部分句 canonical `cn.cliche.trailing-mouth-arc-clause`。
- 2026-07-24：`opening-cliche-era` 与 `inflation-novelty` 已转 `human`。前者旧报告 insufficient 且当前 dataset 无命中；后者旧报告 weak、当前 dataset 仅 1 个 AI 命中，且“前所未有”等词在小说视角和评论中都依赖上下文。
- 2026-07-24：撤回 `cn.modifier.absolute-claim-modifier` 与 `cn.modifier.optional-mood-modifiers` 的旧 strong rule override。当前正式 `report.json` 两条均为 weak，且它们属于已整体下沉的 modifier 桶；默认回到 `human`，避免把“难以言喻的 / 低沉的 / 精准地”等语境敏感修饰词硬塞进 Agent 入口。
- 2026-07-24：`cn.cliche.trailing-sound-clause` 已转 `human`。当前样例多为踩枯枝、碰撞、洗牌等正常动作音效，旧报告仅 weak；保留扫描资产，但不再默认要求 Agent 删除“发出…声/响”尾部分句。
- 2026-07-25：`cn.cliche.baguwen.vague-amount-noun` 已收窄。标点后的“一股”交给 strong canonical `cn.modifier.measure.subject-measure-word`，baguwen 规则只保留句中“一股”和“那股”，避免同 span 量词重复提示。
- 2026-07-25：`cn.modifier.measure.specific-measure-word` 已移除“股”分支，`cn.modifier.heavy-degree-shell` 已收窄为只匹配裸“沉甸甸”。这两处都按“保留 canonical，窄规则只留独有覆盖”的策略降低 `--review all` 重复。
- 2026-07-25：`cn.modifier.measure.physiological-label` 与 `cn.vocabulary.academic-anatomy.physiological-academic-label` 已互斥分工。前者只处理“生理眼泪/生理快感”的前缀；后者只处理“生理性的/生理层面/生理本能”这类分析腔标签，避免“生理性快感”同 span 双报。
- 2026-07-25：当前 dataset 的剩余 active 同 span overlap 已归零。已处理分工：`adverb-intensifier` 移除“极其/本质上”，交给更具体规则；`cn.modifier.sensory-atmosphere-modifier` 移除“戏谑的/地”，交给 `cn.action-expression.teasing-modifier`；`cn.sentence.compound.single-negative-contrast` 排除“并不是…而是”，交给 `cn.sentence.compound.contrastive-turn-preface`。

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
   - 本轮已把 `vocabulary.body`、`vocabulary.r18`、`vocabulary.academic-anatomy`、`color-description`、`sound.once`、`jargon.business`、`regex.advanced` 默认下沉 `human`；`cn.regex.advanced.few-degree` 的 Agent 例外已因扩充 dataset 反证撤回。
   - 待确认：是否把 `vocabulary.body.flesh-skin` / `back-spine` / `mouth-corner`、`sound.once.laugh-one-sound` 等 weak 但人类命中低的规则级例外提回 `agent`，还是继续把这些题材词表留给人工复核。

6. **LLM 金句感是否继续打扰 Agent**
    - 本轮已将宽泛 regex 入口继续下沉：`filler-worth-noting`、开场普通连接词、`transition-summary-essence` 和旧单层否定对比不再进入默认 Agent 桶。
    - 当前仍保留在 `agent` 的同类高语义规则主要是 LLM 版 `quotable-punchline`。因为它不是裸 regex，而是要求读上下文判断“是否只剩姿态”，我暂未机械下沉。
    - 待确认：LLM 版金句感是否继续作为默认 Agent 审查项，还是也转为 `human`。

7. **剩余 Agent 桶 insufficient 规则是否按策略统一下沉**
    - 当前仍保留在 `agent` 且旧报告 verdict 为 `weak` / `insufficient` 的规则主要包括：`cn.cliche.hand-color-clause`、`cn.cliche.trailing-mouth-arc-clause`、`cn.cliche.trailing-sensory-clause`、`cn.cliche.baguwen.unquestionable-claim`，以及 story-deslop 的少量 high blocking 校准规则；其中 `trailing-sensory-clause` 和 `unquestionable-claim` 已先按明确 overlap 收窄，`mouth-corner-arc`、`opening-cliche-era`、`inflation-novelty`、`trailing-sound-clause`、两个 modifier 旧 strong override 已转 `human`。
    - 我没有继续硬改的原因：story-deslop blocking 有独立真人校准来源；嘴角/手部/尾部分句规则虽 support 低，但和 repair-guide 的“身体模板、总结帽子”原则一致，仍像 Agent 可处理的 AI 味候选。
    - 待确认：后续是否采用机械策略“verdict=insufficient 且无 blocking 校准来源 → 默认 `human`”，还是继续允许少量语义明确但样本支持不足的规则留在 `agent`。

8. **canonical 分工是否作为长期整理策略**
    - 当前 dataset 里 active 同 span overlap 已按“保留更具体或更 canonical 的规则、收窄旧规则”处理到 0。
    - 已处理结果不代表全语料永远无 overlap；它只是把当前可证实的重复提示消掉。
    - 待确认：后续是否把“稳定重叠且有 canonical 替代 → 默认收窄或关闭旧规则、不物理删除资产”作为规则整理常规策略。

9. **story-deslop 否定连排是否继续 high blocking**
    - 当前 dataset 重扫发现 `story-deslop.negation-parade.repeated-none` 在一段 reference 中命中“没有混杂木屑，没有太多麸质，”，收窄后 AI 文本中剩 2 处典型命中。
    - 已处理的确定问题：后接“只有/只是/只会”的同 span 场景已排除，避免和 `story-deslop.negation-parade.only-turn` 重复。
    - 我没有直接下沉的原因：这是 story-deslop high blocking 校准规则，原校准集 0 人类命中；单个 reference 命中不足以否定整条规则。
    - 待确认：是否继续保持 `high + agent`，还是收窄为只处理否定后转入抽象总结/情绪结论的结构。

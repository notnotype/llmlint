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
- 2026-07-25：`cn.modifier.measure.specific-measure-word` 已移除“股”分支，并继续移除“这种/那种”指示代词分支；`cn.modifier.heavy-degree-shell` 已收窄为只匹配裸“沉甸甸”。这些都按“保留 canonical 或高信号分支，窄规则只留独有覆盖”的策略降低 `--review all` 噪声。
- 2026-07-25：`cn.modifier.measure.physiological-label` 与 `cn.vocabulary.academic-anatomy.physiological-academic-label` 已互斥分工。前者只处理“生理眼泪/生理快感”的前缀；后者只处理“生理性的/生理层面/生理本能”这类分析腔标签，避免“生理性快感”同 span 双报。
- 2026-07-25：当前 dataset 的 regex active 同 span overlap 已按 canonical 分工清到 0；全 detector 只剩两条 human 宏观节奏规则同段共振 1 处。已处理分工：`adverb-intensifier` 移除“极其/本质上”，交给更具体规则；`cn.modifier.sensory-atmosphere-modifier` 移除“戏谑的/地”，交给 `cn.action-expression.teasing-modifier`；`cn.sentence.compound.single-negative-contrast` 排除“并不是…而是”，交给 `cn.sentence.compound.contrastive-turn-preface`。
- 2026-07-25：`story-deslop.negation-parade.repeated-none` 继续收窄，排除后接“然而/但/却”的真实转折句。当前 reference 误杀“没有混杂木屑，没有太多麸质，然而……”已覆盖，两个 render 典型命中仍保留。
- 2026-07-25：当前 dataset 无命中、旧报告无 verdict、且删除/替换会损失人物语气或普通动作细节的规则转 `human`：`cn.action-expression.explicit-teasing-tone`、`flat-tone-shell`、`force-white-knuckle`、`teasing-attitude-shell`、`tightly-clenched`、`cn.cliche.cup-collision`、`table-cup-touch`、`knuckle-crack`、`cn.sentence.compound.generic-comparison-tone` 和 5 条 weather-tone 口气比喻。保留规则资产，但不再默认要求 Agent 强修。
- 2026-07-25：无校准支撑的身体/触感/声音微细节转 `human`：胸腔/胸膛、冰凉触感、面色、骨节外观、指腹/掌心触感、喉咙/舌尖/咀嚼字句、从齿间挤出、声音突兀/清晰/回荡/传来。处理理由：它们可能是角色可感知的具体画面或人物声音，默认 Agent 不应无上下文删除。
- 2026-07-25：`cn.cliche.direct-mouth-arc`、`cn.cliche.trailing-mouth-arc-clause`、`cn.cliche.hand-color-clause` 和 `cn.cliche.body-reaction.physiological-tears` 已转 `human`。嘴角弧度 direct/trailing 形态在普通输入上可同 span 重叠，手部泛白/生理泪水也属于低支撑身体反应细节，默认交人工上下文判断。
- 2026-07-25：语气强度 / 身体紧绷 / 对白回声 / 场域前置壳转 `human`：`cn.cliche.baguwen.irrefutable-tone-colon`、`irresistible-but`、`taut-neck`、`unquestionable-claim`、`cn.sentence.compound.dialogue-echo-after-quote`、`setting-space-preface`。这些规则无校准支撑，且可能服务人物状态、停顿节奏或空间调度。
- 2026-07-25：`cn.action-expression.rough-manner-modifier` 已转 `human`。旧报告为 strong，但当前命中包含“呼吸粗重”“字体更加粗重”“疯狂码字”“能量疯狂涌入”“心脏疯狂跳动”等真实动作、状态或物性描述；全语料 reference 侧也有“疯狂的大叫 / 疯狂的大声叫道”合法用法，裸词默认 Agent 删除风险过高。
- 2026-07-25：高频 Agent 规则处理边界已补强：`cn.proliferation.mixed.repeated-de-pairs` 保留强判别入口但 note 要求只压缩装饰性形容词堆叠，`cn.cliche.trailing-sensory-clause` 保留 render-only 尾巴信号但 note 要求保留必要动作、物性和信息细节。
- 2026-07-25：`cn.numeral.three.numeral-three` 已默认关闭。裸“三”在当前 dataset 命中 119 次，包含大量真人正常数字表达；这是素材转换遗留，不适合作为 active human 规则。
- 2026-07-25：`cn.proliferation.mixed.extra-punctuation` 与 `cn.punctuation.dash.dash-alone-to-comma` 已默认关闭。前者把普通逗号、顿号、句号、省略号当“增殖标点”，当前 dataset reference 命中 172 次；后者把裸破折号机械替逗号，reference 命中 21 次且多为悬念、插入解释、拖长音和节奏停顿。
- 2026-07-25：`business-jargon` 已从裸词表收窄为业务语境 detector。`落地/链路/打法/沉淀/心智` 不再裸命中“落地镜”“轻巧落地”“灵魂链路”“这种打法”“情绪沉淀”，当前 fiction dataset 命中归零；业务文里的“对齐/业务链路/方案落地/增长打法”等仍保留 human advisory。
- 2026-07-25：`cn.modifier.stacked-degree-adverbs` 已收窄。移除逐次提示价值低的“突然/忽然/稍微/略微/稍稍”，以及会半截命中“凶猛的/迅猛的”的“猛的”；`下意识/无意识/不自觉/习惯性` 只保留 adverbial “...地”。当前 dataset 从 reference 60 / render 305 降到 reference 25 / render 234。
- 2026-07-25：`adverb-intensifier` 继续收窄，移除“非常/十分/特别”，只保留更偏公文和抽象判断的强化词；“极其/本质上”此前已交给更具体规则。
- 2026-07-25：`cn.cliche.trailing-sensory-clause` 已从泛尾部分句 detector 收窄为抽象情绪/气质/语气尾巴，放过“破风声 / 指甲 / 喉咙 / 气味 / 温度 / 回音”等具体物性信息；`cn.modifier.measure.subject-measure-word` 移除“这具/那具”，只保留句首或标点后的“一股”量词壳。
- 2026-07-25：`cn.punctuation.dedup.repeated-symbols` 从 `none/auto` 降级为 `human/manual`。重复感叹号/问号在小说对白和拟声中常承担语气，不再由 `fix --write` 自动压缩；自动修复桶只保留更机械的零宽与省略号/破折号尾巴清理。
- 2026-07-25：`lazy-extremes` 已收窄，移除“所有人/每个人/永远/一定会”等小说常用表达，只保留“大家都/从来不/必然/毫无例外/没有人/任何人都”这类更像无范围断言的分支。
- 2026-07-25：`transition-summary-restate` 与 `inflation-superlative` 已转 `human`，当前 dataset 真人侧不低于 AI 侧，且命中多为设定解释、任务规则或说明性对白；`story-deslop.action-list` 已转 `human`，避免把打斗/追逐/调查等功能性动作编排默认交 Agent 强修。
- 2026-07-25：继续按 canonical 分工收敛 active overlap：`cn.modifier.ineffable-absolute-modifier` 与 `cn.modifier.sticky-optional` 默认关闭；`cn.modifier.near-collapse-modifier` 排除带“的/地”的“崩溃”；`cn.modifier.stacked-degree-adverbs` 移除“一丝丝”和“近乎/近乎于”。当前复扫 active 同 span overlap 只剩两条 human 宏观节奏规则共振 1 处。
- 2026-07-25：低信号 human 规则继续默认关闭：`filler-word-actually`、`filler-can-say`、`quotable-punchline-candidate`、`comprehensive-listing`、`cn.cliche.baguwen.sudden-moment`、`cn.cliche.baguwen.even-is`。这些规则在当前 dataset reference 侧不低于 AI 侧，或裸 regex 会误报有信息表达；保留资产给项目显式开启。
- 2026-07-25：`meta-announcement` 收窄为“下面/接下来我们将介绍/分析…”这类教程导语，裸“接下来”不再提示；`jargon-engineer-debug` 移除“收敛/收束/锁住”，避免误伤小说动作和状态。
- 2026-07-26：低信号 human 规则继续默认关闭：`filler-lets`、`lazy-extremes`、`transition-summary-conclude`、`transition-summary-restate`、`inflation-superlative`、`inflation-marvel`、`cn.punctuation.dedup.repeated-symbols`、`cn.regex.advanced.momentary-reaction`。`assistant-comfort-pose` 与 `jargon-social-extra` 保持 active，但收窄到明确第二人称安抚和爆款文风词。
- 2026-07-26：`cn.sentence.compound.unrealized-subject-preface` 因职责被 `contrastive-turn-preface` 覆盖且旧替换会删真实对比，已默认关闭；`cn.vocabulary.body.muscle-texture` 因“肌理→肌肉”并非无损替换，已默认关闭。当前 active exact regex target 重复为 0；低信号 human（reference 命中不低于 render）只剩 `story-deslop.action-list` 1 / 0，留作产品取舍。

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

4. **creative overlap / canonical 分工是否作为长期策略**
   - 本轮已把 creative profile 里稳定 overlap 的旧规则同步为默认 `enabled:false`，并继续按“保留更具体或 canonical 的规则、收窄旧规则”把当前 dataset 的 active 同 span regex overlap 清到 0。
   - 已处理结果不代表全语料永远无 overlap；规则资产仍保留，项目可显式开启。
   - 待确认：后续是否固定采用“稳定重叠且有 canonical 替代 → 默认收窄或关闭旧规则、不物理删除资产”的整理策略。

5. **人工桶后的规则级例外是否要提回 Agent**
   - 本轮已把 `vocabulary.body`、`vocabulary.r18`、`vocabulary.academic-anatomy`、`color-description`、`sound.once`、`jargon.business`、`regex.advanced` 默认下沉 `human`；`cn.regex.advanced.few-degree` 的 Agent 例外已因扩充 dataset 反证撤回。
   - 待确认：是否把 `vocabulary.body.flesh-skin` / `back-spine` / `mouth-corner`、`sound.once.laugh-one-sound` 等 weak 但人类命中低的规则级例外提回 `agent`，还是继续把这些题材词表留给人工复核。

6. **LLM 金句感是否继续打扰 Agent**
    - 本轮已将宽泛 regex 入口继续下沉：`filler-worth-noting`、开场普通连接词、`transition-summary-essence` 和旧单层否定对比不再进入默认 Agent 桶。
    - 当前仍保留在 `agent` 的同类高语义规则主要是 LLM 版 `quotable-punchline`。因为它不是裸 regex，而是要求读上下文判断“是否只剩姿态”，我暂未机械下沉。
    - 待确认：LLM 版金句感是否继续作为默认 Agent 审查项，还是也转为 `human`。

7. **剩余 Agent 桶 insufficient 规则是否按策略统一下沉**
    - 当前仍保留在 `agent` 且旧报告 verdict 为 `weak` / `insufficient` 的主要是 story-deslop 的少量 high blocking 校准规则，以及已二次收窄后的 `cn.cliche.trailing-sensory-clause`。
    - 我没有继续硬改的原因：story-deslop blocking 有独立真人校准来源；`trailing-sensory-clause` 当前已降到 render 10 / reference 0，只保留抽象情绪/气质/语气尾巴，暂未形成转 `human` 的反证。
    - 待确认：后续是否采用机械策略“verdict=insufficient 且无 blocking 校准来源 → 默认 `human`”，还是继续允许少量语义明确但样本支持不足的规则留在 `agent`。

8. **story-deslop 否定连排是否继续 high blocking**
    - 当前 dataset 继续收窄后，reference 误杀暂为 0，AI 文本剩 2 处典型命中。
    - 已处理的确定问题：后接“只有/只是/只会”的同 span 场景已排除，避免和 `story-deslop.negation-parade.only-turn` 重复；后接“然而/但/却”的真实转折也已排除。
    - 我没有直接下沉的原因：这是 story-deslop high blocking 校准规则，原校准集 0 人类命中；当前语料支持偏少，但没有形成反证。
    - 待确认：是否继续保持 `high + agent`，还是进一步收窄为只处理否定后转入抽象总结/情绪结论的结构。

9. **强判别规则的人类侧少量命中是否接受**
    - 当前默认 Agent 桶在 dataset reference 侧仍命中的规则只剩三条：`cn.cliche.baguwen.vague-amount-noun`（reference 2 / render 125）、`story-deslop.not-is-comparison`（reference 2 / render 53）和 `cn.proliferation.mixed.repeated-de-pairs`（reference 1 / render 163）。
    - `vague-amount-noun` 的 reference 命中是“是一股陌生的摩挲拉拽感”和“藏着一股玩味的笑意”；这类“一股”在真人小说里并非不可用，但在 render 中高频变成情绪/气息/压力的泛化量词。
    - `not-is-comparison` 的 reference 命中来自镜像视觉辨认和世界观事实辨析；这类“不是 A，而是 B”有真实语义功能，但继续硬加“自己/古代遗留”等字面特例会让 handler 变脆，暂未修改。
    - `repeated-de-pairs` 的 reference 命中是“鲁莽的、缺乏手段的、不考虑后果的”，属于真实排比强化；render 中大量命中是“陌生的、昏暗的 / 冰冷的、混乱的、令人...”式堆叠形容。
    - 待确认：是否接受这类强判别规则保留少量人类侧命中，交 Agent 读上下文判断；还是把它们转 `human` / 增加更强结构条件，牺牲一部分 AI 文本召回。

10. **剩余高频 human 桶是否继续激进收窄**
    - 本轮已把 `extra-punctuation`、裸破折号替逗号、商业黑话裸词、`stacked-degree-adverbs` 的低信号/重复分支、`specific-measure-word` 的“这种/那种”、重复感叹/问号、总结/通胀/绝对词和瞬时反应等低信号 human regex 默认关闭或收窄；当前 active human 中只有 `story-deslop.action-list` 的 reference 命中不低于 render（1 / 0）。
    - 剩余高频 human 规则仍包括：`cn.modifier.stacked-degree-adverbs`、`cn.modifier.measure.specific-measure-word`、`cn.metaphor.trailing-simile-clause`、`cn.metaphor.simile-modifier-shell`、`story-deslop.quote-emphasis`、`sound.once` 词表等。
    - 我没有继续硬改的原因：这些规则的 render 偏高仍有价值，但 reference 命中多是正常小说表达，例如“一道轨迹/一层光/一点细节”、有效比喻和功能性动作编排；继续收窄需要更明确的产品取舍。
    - 待确认：`--review all` 是否要偏“干净列表”（继续默认关闭/大幅收窄这些 human 规则），还是偏“素材雷达”（保留 high-recall human advisory，让编辑器和人工判断承担噪声）。

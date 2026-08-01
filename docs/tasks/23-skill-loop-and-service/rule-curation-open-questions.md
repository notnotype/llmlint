# Rule Curation Decisions

> 目的：记录默认规则库整理的证据与用户治理决策。原待决项已于 2026-07-31 统一拍板；后续调整按本文件执行，不再把这些问题重复当成开放项。

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

- 2026-07-26：**比喻家族路由已裁决，结论是保持 `human`**（第 10 条的一个具体切片，不构成对第 10 条整体的拍板）。复算全语料 26 篇 reference / 100 篇 render（可见字 78,971 / 355,756，体量比 4.50），用池化每千字率与富集比取代中位 fireRate（稀疏规则上中位退化为 0）：

  | 规则 | 富集 | 真人侧命中文档 | prevLift |
  | --- | --- | --- | --- |
  | `cn.metaphor.trailing-simile-clause` | 5.3x | **23%** | 2.54 |
  | `cn.metaphor.simile-modifier-shell` | 2.8x | **35%** | 1.91 |
  | `story-deslop.metaphor-density` | 2.8x（原始标记 4.2x） | 12% | 2.51 |
  | 对照：`repeated-de-pairs`（agent） | 20.7x | 4% | 3.90 |
  | 对照：`vague-amount-noun`（agent） | 10.2x | 8% | 4.01 |
  | 对照：`not-is-comparison`（agent） | 4.5x | 8% | 2.71 |

  定量上 `trailing-simile-clause` 的富集（5.3x）高于两条已在 agent 桶的规则，但真人侧文档命中率 23% / 35% 是当前 agent 桶全部规则（0–8%）的 3–9 倍。定性证据更决定性：真人侧命中几乎全是出版小说里承担信息的有效比喻——「犹如拗口令一般」「如是玩物一般」（天龙八部）、「仿佛是西瓜爆炸一般」（无限恐怖）、「仿佛在看讲述维多利亚时期故事的英剧」（诡秘之主，承担时代设定）。决策口径要求「真人命中形态可辨为装饰性」，此条不成立，因此不提回 `agent`。
- 2026-07-26：复算顺带发现并修掉一处**规则越界**：`cn.metaphor.trailing-simile-clause` 的 detector 用无上界 `[一-鿿、]+`，会把「，像自己这样坐两个小时地铁到市中心已经能算是她半年以来出过最远的一次远门了」这类 40 字解释性长从句当成「尾部比喻壳」。加 `{2,20}` 上界后真人命中 8→7、真人侧文档 23%→19%、富集 5.3x→5.8x，AI 召回只降 3%（207→201）。规则仍留在 `human`，但 `--review all` 的信号质量提升——这在本轮把 `--review all` 定为创作类主路径后更重要。三条规则的 `note` 都已写入本轮证据与处理边界。

## 用户决策（2026-07-31）

1. **story-oracle 只吸收原则。** 没有可校验来源与许可时，不搬原文、不据此导入具体规则；将来拿到合法来源后再单独评估。
2. **不支持 ASCII 直引号分域。** `quoted` 只认 `「」`、`『』`、`“”`、`‘’`、`【】`；无方向性的 `"` / `'` 不进入配对状态机。
3. **复读 / 截断以后做独立完整性 smoke。** 它们不混进本轮 AI 味默认规则库；本轮也不实现新 smoke。
4. **canonical 消重是长期策略。** 稳定重叠且有 canonical 替代时，只收窄或默认关闭旧规则，不物理删除资产，保留项目显式启用能力。
5. **弱词表留在 `human`。** `vocabulary.body`、`sound.once` 等题材词表不因低真人命中就提回默认 Agent 入口。
6. **语义金句感留在 `agent`。** 保留 `quotable-punchline` 的上下文判断，不恢复已下沉的宽泛 regex 入口。
7. **`insufficient` 逐条校准。** 不采用“无 support 一律下沉”的机械策略；结合独立校准、语义边界、真人反证和命中形态逐条决定。
8. **否定连排维持 `high + agent`。** 继续保留现有 blocking 校准与已经收窄的排除条件；出现新反证时再收窄。
9. **接受强判别规则少量真人命中。** `vague-amount-noun`、`not-is-comparison`、`repeated-de-pairs` 保留默认 Agent 入口，由 Agent 读语境判定，不用脆弱字面特例换取表面零误报。
10. **human 桶保留高召回，通过排序与聚合降负担。** 不继续为“干净列表”激进关闭有效素材雷达；优先在展示层按信号、规则族和位置聚合，减少人工逐条阅读成本。

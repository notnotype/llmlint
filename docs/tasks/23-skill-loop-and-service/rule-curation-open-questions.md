# Rule Curation Open Questions

> 目的：规则系统精简时，凡是我无法靠现有 eval / overlap / 许可边界直接判断的事项，先集中记录在这里，最后一次性交给用户拍板。

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

4. **比喻壳规则族的 canonical 选择**
   - `cn.metaphor.inserted-simile-shell` 与 `cn.metaphor.simile-modifier-shell` 高重叠；现有证据显示一侧命中几乎被另一侧覆盖，但二者仍有不同句法范围。
   - 待确认：是否默认关闭 `inserted-simile-shell`，统一保留 `simile-modifier-shell`。

5. **氛围修饰语规则族是否默认收窄**
   - `cn.modifier.sensory-atmosphere-modifier`、`cn.modifier.template-atmosphere-modifier`、`cn.modifier.sensory-atmosphere-core` 在当前 creative profile 中多为 noise，且彼此高重叠。
   - 待确认：是否将其中部分默认关闭，只保留更具体或更稳定的一条。

6. **状态修饰语规则族是否默认收窄**
   - `cn.modifier.excessive-state-simile`、`cn.modifier.template-state-modifier`、`cn.modifier.hollow-state-modifier` 高重叠，但当前 verdict 多为 weak，不能单靠本轮 eval 物理删除。
   - 待确认：是否选择一个 canonical 默认保留，其余默认关闭；若保留多个，是否下调 review 到 human。

7. **句中总结 / 模糊转场规则族是否合并**
   - `cn.cliche.mid-sentence-summary` 与 `cn.cliche.vague-transition-phrase` 出现高同 span 重叠；后者在当前 report 中更强。
   - 待确认：是否默认关闭 `mid-sentence-summary`，统一交给 `vague-transition-phrase`。

8. **默认规则是否继续同步 creative overlap 抑制**
   - 本轮已把 creative profile 里稳定 overlap 的 8 条旧规则同步为默认 `enabled:false`，保留规则资产和用户显式开启能力。
   - 待确认：后续是否把这个作为规则整理常规策略：稳定重叠且有 canonical 替代时，默认关闭旧规则，但不物理删除。

9. **人工桶后的规则级例外是否要提回 Agent**
   - 本轮已把 `vocabulary.body`、`vocabulary.r18`、`vocabulary.academic-anatomy`、`color-description`、`sound.once`、`jargon.business`、`regex.advanced` 默认下沉 `human`；只把 `cn.regex.advanced.few-degree` 作为强信号例外保留 `agent`。
   - 待确认：是否把 `vocabulary.body.flesh-skin` / `back-spine` / `mouth-corner`、`sound.once.laugh-one-sound` 等 weak 但人类命中低的规则级例外提回 `agent`，还是继续把这些题材词表留给人工复核。

10. **宽泛低信号规则是否继续打扰 Agent**
    - 本轮已将 `filler-word-actually`、`meta-announcement`、`quotable-punchline-candidate` 下沉 `human`；但 `filler-worth-noting`、`filler-can-say`、`filler-lets` 与 LLM 版 `quotable-punchline` 仍在 `agent`。
    - 待确认：是否进一步把这些宽泛填充词 / 金句感默认转为 `human`，或保持当前状态，让 Agent 继续处理明确模板化的用法。

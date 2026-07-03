import type {LintRuleRecord} from "../types";

/**
 * 开场套话（opening.cliche）。
 *
 * 取材自 shuorenhua/references/phrases-zh.md「开场套话」段（Tier 1，默认替换）。
 * 这些是 AI 文本里高频的「先宣布、再进入」式开场，正文默认展示（review=agent）。
 * 已避开 base-rules 核心规则中 filler-worth-noting / dated-opening / filler-can-say 已覆盖的词。
 */
export const OPENER_RULES = [
    {
        "id": "opening-cliche-announce",
        "namespace": "opening.cliche",
        "title": "开场宣告套话",
        "level": "medium",
        "note": "AI 高频的开场宣告，先宣布「这里有重点」再进入内容，删掉后句意通常不变。引用原文或讨论该说法本身时保留。",
        "detector": {
            "type": "regex",
            "targets": [
                "值得一提的是|不难发现|不容忽视"
            ]
        },
        "action": {"type": "replace", "replacements": [""]}
    },
    {
        "id": "opening-cliche-invite",
        "namespace": "opening.cliche",
        "title": "虚假邀请开场",
        "level": "medium",
        "note": "「让我们一起来看看 / 接下来我将为你」是助手腔的邀请式开场，正文里直接进入内容即可。",
        "detector": {
            "type": "regex",
            "targets": [
                "让我们一起来看看|让我们来看看|接下来我将为你|接下来我会为你|接下来我来"
            ]
        },
        "action": {"type": "replace", "replacements": [""]}
    },
    {
        "id": "opening-cliche-era",
        "namespace": "opening.cliche",
        "title": "宏大时代开场",
        "level": "medium",
        "note": "用宏大背景替代具体事实的作文式开场。改成具体时间、对象或事件。",
        "detector": {
            "type": "regex",
            "targets": [
                "在当今这个[^，。！？\\n]{0,12}的时代|在这个[^，。！？\\n]{0,12}的时代|随着[^，。！？\\n]{0,20}的不断发展"
            ]
        },
        "action": {"type": "suggest", "message": "删掉宏大背景，直接给具体时间、对象、事件或数据。"}
    },
    {
        "id": "opening-cliche-deepdive",
        "namespace": "opening.cliche",
        "title": "深入探讨式预告",
        "level": "low",
        "note": "「深入探讨 / 深入剖析」是预告姿态，多数可删掉直接讨论。",
        "detector": {
            "type": "regex",
            "targets": [
                "深入探讨|深入剖析|深入解读"
            ]
        },
        "action": {"type": "suggest", "message": "删掉预告姿态，直接展开讨论。"}
    },
    {
        "id": "opening-cliche-concession",
        "namespace": "opening.cliche",
        "title": "公式化让步开场",
        "level": "low",
        "note": "「诚然」式让步常用来铺一个假转折，多数可删掉直接陈述。",
        "detector": {
            "type": "regex",
            "targets": [
                "诚然|无可否认"
            ]
        },
        "action": {"type": "replace", "replacements": [""]}
    },
    {
        "id": "opening-cliche-moreover",
        "namespace": "opening.cliche",
        "title": "更重要的是 / 具体来说",
        "level": "low",
        "note": "「更重要的是 / 具体来说 / 更进一步说」是 AI 常用的推进过渡，多数可删掉直接说下一点。偶尔承担真实转折时保留。",
        "detector": {
            "type": "regex",
            "targets": [
                "更重要的是|具体来说|更进一步(?:说|地说)?|进一步来说"
            ]
        },
        "action": {"type": "suggest", "message": "若没有真正递进，删掉直接说下一点。"}
    }
] satisfies LintRuleRecord[];

import type {LintRuleRecord} from "../types";

/**
 * 无源引用（attribution.vague）+ 正能量收尾模板（cliche.uplift）。
 *
 * 取材自 shuorenhua/references/phrases-zh.md「无源引用 / 正能量收尾模板」段（Tier 1）。
 * 对应 avoid-ai-writing 的 vague-attribution / future-narrative。正文默认展示（review=agent）。
 */
export const ATTRIBUTION_RULES = [
    {
        "id": "attribution-vague",
        "namespace": "attribution.vague",
        "title": "无源引用",
        "level": "medium",
        "note": "「研究表明 / 数据显示 / 有专家指出」不给具体出处，是公开写作里典型的 AI 痕迹。给出具体来源或直接给数据。",
        "detector": {
            "type": "regex",
            "targets": [
                "研究表明|研究显示|数据表明|数据显示|有专家(?:指出|认为|表示)|业内人士(?:认为|指出)|据(?:报道|悉|了解)"
            ]
        },
        "action": {"type": "suggest", "message": "给出具体研究名称、数据来源、专家姓名或媒体与时间；查无来源则删掉。"}
    },
    {
        "id": "attribution-general-belief",
        "namespace": "attribution.vague",
        "title": "泛化共识引用",
        "level": "low",
        "note": "「普遍认为 / 人们普遍认为 / 一般来说」把一个观点说成共识却不给依据。给出依据或改成具体的「谁认为」。",
        "detector": {
            "type": "regex",
            "targets": [
                "(?:人们)?普遍认为|一般认为|通常认为|长期以来(?:人们)?(?:都)?认为"
            ]
        },
        "action": {"type": "suggest", "message": "给出依据，或改成具体的「谁、在什么场合认为」。"}
    },
    {
        "id": "uplift-await",
        "namespace": "cliche.uplift",
        "title": "鸡汤式期待收尾",
        "level": "medium",
        "note": "「让我们拭目以待 / 未来可期」是空洞的正能量收尾，删掉，不做鸡汤。",
        "detector": {
            "type": "regex",
            "targets": [
                "让我们拭目以待|拭目以待|未来可期|未来值得期待"
            ]
        },
        "action": {"type": "replace", "replacements": [""]}
    },
    {
        "id": "uplift-embrace",
        "namespace": "cliche.uplift",
        "title": "积极拥抱式收尾",
        "level": "low",
        "note": "「与其……不如积极拥抱……」式收尾是 AI 偏爱的鸡汤句式，多数可删掉。",
        "detector": {
            "type": "regex",
            "targets": [
                "与其[^，。！？\\n]{0,20}不如(?:积极)?(?:拥抱|迎接|面对)|让我们(?:一起)?(?:拥抱|迎接|携手)"
            ]
        },
        "action": {"type": "suggest", "message": "删掉号召姿态，回到具体判断或事实。"}
    }
] satisfies LintRuleRecord[];

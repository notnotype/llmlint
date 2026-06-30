import type {LintRuleRecord} from "../types";

/**
 * 黑话三类：商业黑话扩展（jargon.business）、工程师/调试腔（jargon.engineer）、自媒体腔（jargon.social）。
 *
 * 取材自 shuorenhua/references/phrases-zh.md「商业/互联网黑话 / 工程师腔 / 暴力动作腔 / 自媒体腔」段。
 * engineer / social 误杀率高（技术语境、网络用语都可能合理），按命名空间策略默认归 human 桶，
 * 默认不刷 agent 视图；business 在小说里少见但出现即明显，保持默认展示。
 */
export const JARGON_RULES = [
    {
        "id": "jargon-business-extra",
        "namespace": "jargon.business",
        "title": "商业黑话候选（扩展）",
        "level": "low",
        "note": "互联网/商业黑话，常遮住具体动作。判断目标读者是否需要；遮住动作时改写为谁在何时做了什么。引用或讨论该术语本身时保留。",
        "detector": {
            "type": "regex",
            "targets": [
                "助力|打造|场景化|降本增效|底层逻辑|顶层设计|体感|触达|透传|拉齐|痛点|商业模式"
            ]
        },
        "action": {"type": "suggest", "message": "改写为具体动作：谁、在何时、对什么、做了什么、得到什么结果。"}
    },
    {
        "id": "jargon-engineer-debug",
        "namespace": "jargon.engineer",
        "title": "工程师 / 调试腔",
        "level": "low",
        "note": "AI 把 debug 术语用到日常对话，像写 postmortem。误杀防护：纯技术报告/incident/变更日志里「根因/收口/收敛」是标准术语应保留；若描述系统主语行为（如网关返回 504）也保留。小说叙述里出现这类姿态词才是 AI 味。",
        "detector": {
            "type": "regex",
            "targets": [
                "稳稳兜住|砍一刀|收口|收窄|打掉问题|避免漂移|落盘|兜底|压实|收敛|收束|锁住|口径|对上了|坐实了"
            ]
        },
        "action": {"type": "suggest", "message": "非纯技术语境时，改成自然说法：处理好、缩小范围、收尾、确认、保存、吻合等。"}
    },
    {
        "id": "jargon-engineer-violent",
        "namespace": "jargon.engineer",
        "title": "暴力动作 / 问诊腔",
        "level": "low",
        "note": "AI 用激烈动词凸显执行力，多是多余的气势渲染。「揪出来/抠出来」是庸医问诊腔，「补一刀/狠狠干」是暴力动作腔。",
        "detector": {
            "type": "regex",
            "targets": [
                "补一刀|狠狠干|更狠|狠一点|拍脑门|拍板|抠出来|揪出来|扒开|拽出来"
            ]
        },
        "action": {"type": "suggest", "message": "改成中性动作：补充、找出、定位、决定（说清楚谁决定）。"}
    },
    {
        "id": "jargon-social-media",
        "namespace": "jargon.social",
        "title": "自媒体 / 小红书 AI 腔",
        "level": "low",
        "note": "爆款文风标志词。单独使用是正常网络用语，AI 批量堆砌时暴露机器痕迹。真人在具体经历后自然使用（有细节支撑）时不算 AI 腔。",
        "detector": {
            "type": "regex",
            "targets": [
                "保姆级|硬核(?:干货|分析|教程)?|干货(?:满满)?|一文(?:读懂|看懂|搞懂)|万字长文|建议收藏|强烈推荐|划重点|绝绝子|谁懂啊|真的会谢|姐妹们|避坑指南|不踩坑"
            ]
        },
        "action": {"type": "suggest", "message": "删掉营销词，或换成具体说法（详细、注意别犯的错等）。"}
    },
    {
        "id": "jargon-engineer-extra",
        "namespace": "jargon.engineer",
        "title": "工程师腔（补充）",
        "level": "low",
        "note": "「说穿了 / 说人话就是 / 更稳 / 偏硬」等调试腔补充。技术语境合理时保留。",
        "detector": {
            "type": "regex",
            "targets": [
                "说穿了|说人话就是|更稳|最稳|偏硬|硬写|做一个更硬的"
            ]
        },
        "action": {"type": "suggest", "message": "非技术语境改成自然说法：说白了、更可靠、太死板等；多数「说穿了/说人话就是」可直接删。"}
    },
    {
        "id": "jargon-social-extra",
        "namespace": "jargon.social",
        "title": "自媒体腔（补充）",
        "level": "low",
        "note": "「狠狠 XX 了 / 拿捏 / 天花板 / 封神 / 一键三连」等爆款文风词，AI 批量堆砌时暴露机器痕迹。",
        "detector": {
            "type": "regex",
            "targets": [
                "狠狠(?:地)?[^，。！？\\n]{1,4}了|拿捏(?:得)?死死的?|(?:是|算)[^，。！？\\n]{0,6}天花板|直接封神|一键三连|记得(?:点赞|关注|收藏)"
            ]
        },
        "action": {"type": "suggest", "message": "删掉爆款腔，改成中性、具体的说法。"}
    }
] satisfies LintRuleRecord[];

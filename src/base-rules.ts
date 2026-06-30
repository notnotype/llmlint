import type {LintRuleRecord} from "./types";
import {OPENER_RULES} from "./base-rules/openers";
import {INFLATION_RULES} from "./base-rules/inflation";
import {TRANSITION_SUMMARY_RULES} from "./base-rules/transitions";
import {ATTRIBUTION_RULES} from "./base-rules/attribution";
import {ASSISTANT_RULES} from "./base-rules/assistant";
import {JARGON_RULES} from "./base-rules/jargon";
import {TRANSLATIONESE_RULES} from "./base-rules/translationese";
import {TIER2_RULES} from "./base-rules/tier2";
import {MECHANICAL_RULES} from "./base-rules/mechanical";

/**
 * llmlint 官方默认规则集中人工维护的核心基础规则（最早一批 anti-ai-slop 规则）。
 * 新增的成体系规则按主题拆到 base-rules/ 目录下的模块，再在文件末尾聚合。
 */
const CORE_BASE_RULES = [
    {
        "id": "filler-word-actually",
        "namespace": "filler",
        "title": "无意义填充词",
        "level": "medium",
        "note": "这类词通常不增加实质内容，只是为了让语气显得缓和或自然。读取上下文判断是否为角色口癖；若删除后句意不变，建议直接删除。",
        "detector": {
            "type": "regex",
            "targets": [
                "其实|实际上|事实上"
            ]
        },
        "action": {
            "type": "replace",
            "replacements": [
                ""
            ]
        }
    },
    {
        "id": "filler-worth-noting",
        "namespace": "filler",
        "title": "喉舌式开头",
        "level": "medium",
        "note": "这类开头先宣布重点再进入内容，常削弱陈述力度。",
        "detector": {
            "type": "regex",
            "targets": [
                "值得注意的是|需要指出的是|需要强调的是"
            ]
        },
        "action": {
            "type": "replace",
            "replacements": [
                ""
            ]
        }
    },
    {
        "id": "filler-can-say",
        "namespace": "filler",
        "title": "弱化陈述词",
        "level": "low",
        "note": "这类词弱化了陈述的确定性，通常可以直接删除。",
        "detector": {
            "type": "regex",
            "targets": [
                "可以说|不得不说"
            ]
        },
        "action": {
            "type": "replace",
            "replacements": [
                ""
            ]
        }
    },
    {
        "id": "filler-lets",
        "namespace": "filler",
        "title": "虚假邀请句式",
        "level": "low",
        "note": "“让我们”常用于制造共同探讨感，在正式写作中容易显得做作。",
        "detector": {
            "type": "regex",
            "targets": [
                "让我们"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "改为“我们”或直接陈述，避免虚假的邀请感。"
        }
    },
    {
        "id": "firstly-secondly",
        "namespace": "transition.mechanical",
        "title": "机械列举过渡",
        "level": "high",
        "note": "这种列举方式过于刻板，缺乏自然的叙述节奏。",
        "detector": {
            "type": "regex",
            "targets": [
                "首先.*?其次.*?(?:最后|再次)"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "如果不是技术步骤或报告提纲，改成自然并列、因果推进，或直接使用列表。"
        }
    },
    {
        "id": "on-one-hand",
        "namespace": "transition.mechanical",
        "title": "机械对比过渡",
        "level": "medium",
        "note": "这种对比方式过于套路化，更自然的写作会使用更灵活的过渡。",
        "detector": {
            "type": "regex",
            "targets": [
                "一方面.*?另一方面"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "用简单并列、转折或具体因果替代机械对比。"
        }
    },
    {
        "id": "not-but-structure",
        "namespace": "contrast.binary",
        "title": "二元对比结构",
        "level": "medium",
        "note": "“不是...而是...”可以被稳定识别为候选结构，是否生硬仍需要结合上下文判断。",
        "detector": {
            "type": "regex",
            "targets": [
                "不是[^。！？\\n，,；;]*?[，,；;]?\\s*而是"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "判断前半部分是否在纠正真实误解；若只是制造戏剧化，可直接陈述“而是”后的内容。"
        }
    },
    {
        "id": "not-x-is-y",
        "namespace": "contrast.binary",
        "title": "问题定义对比",
        "level": "medium",
        "note": "定义式反转可以被静态识别，是否多余需要结合上下文判断。",
        "detector": {
            "type": "regex",
            "targets": [
                "(?:问题|答案|关键)不是[^。！？\\n，,；;]*?[，,；;]?\\s*(?:是|在于)"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "判断前半部分是否在重新框定问题；若只是铺垫反转，改为直接陈述核心判断。"
        }
    },
    {
        "id": "negative-listing",
        "namespace": "contrast.negative-listing",
        "title": "负向列举",
        "level": "medium",
        "note": "连续否定常用来制造揭示感，但很多时候读者不需要先看一串被否定的选项。",
        "detector": {
            "type": "regex",
            "targets": [
                "(?:不是|并非)[^。！？\\n]{0,24}(?:。|，|,|；|;)?\\s*(?:也不是|不是|并非)"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "如果否定项没有纠正常见误解，建议直接陈述真正判断。"
        }
    },
    {
        "id": "dated-opening",
        "namespace": "opening.mouthpiece",
        "title": "喉舌式时代开头",
        "level": "medium",
        "note": "这些是典型的作文式开头，容易用宏大背景替代具体事实。",
        "detector": {
            "type": "regex",
            "targets": [
                "在当今社会|随着.*?的发展|众所周知|不可否认"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "直接进入具体对象、事件、数据或场景。"
        }
    },
    {
        "id": "empty-expression",
        "namespace": "abstraction.hollow",
        "title": "空洞抽象表达",
        "level": "low",
        "note": "这些评价性表达缺乏具体内容，常见于公文和模板化文本。",
        "detector": {
            "type": "regex",
            "targets": [
                "具有.*?意义|起到.*?作用|产生.*?影响|取得.*?成效"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "用具体事实、动作、结果替代抽象评价，说明实际发生了什么。"
        }
    },
    {
        "id": "comprehensive-listing",
        "namespace": "transition.mechanical",
        "title": "全面式并列结构",
        "level": "medium",
        "note": "这种面面俱到的并列结构容易为了显得全面而稀释重点。",
        "detector": {
            "type": "regex",
            "targets": [
                "无论(?:是)?.*?还是.*?都|不仅.*?而且.*?(?:更|还)"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "简化为简单并列，或只保留最重要的一点。"
        }
    },
    {
        "id": "meta-announcement",
        "namespace": "meta",
        "title": "元叙述式公告",
        "level": "low",
        "note": "这些是自我引用的结构公告，文本先宣布自己要做什么，而不是直接推进内容。",
        "detector": {
            "type": "regex",
            "targets": [
                "下面(?:我们)?(?:将)?(?:来)?(?:介绍|分析|探讨)|接下来(?:我们)?(?:将)?|本文(?:将)?(?:从|通过)|本节(?:将)?(?:介绍|说明|分析)"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "如果不是教程、报告或章节导语，建议直接进入内容。"
        }
    },
    {
        "id": "rhetorical-setup",
        "namespace": "rhetorical-question",
        "title": "公式化设问",
        "level": "medium",
        "note": "公式化设问常用来制造悬念，但多数时候下一句可以直接陈述。",
        "detector": {
            "type": "regex",
            "targets": [
                "为什么这么说|这意味着什么|这说明什么|你有没有想过|试想一下|换个角度想|你可能会问"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "若问题没有真正打开思考空间，删掉设问并直接陈述答案。"
        }
    },
    {
        "id": "emphasis-crutch",
        "namespace": "emphasis-crutch",
        "title": "强调拐杖",
        "level": "medium",
        "note": "这类词常用强调姿态替代具体内容。",
        "detector": {
            "type": "regex",
            "targets": [
                "毫无疑问|显而易见|毋庸置疑|请记住|重点是|关键在于|说到底|归根结底"
            ]
        },
        "action": {
            "type": "replace",
            "replacements": [
                ""
            ]
        }
    },
    {
        "id": "business-jargon",
        "namespace": "jargon.business",
        "title": "商务黑话候选",
        "level": "low",
        "note": "这类词可能是准确术语，也可能遮住了具体动作。",
        "detector": {
            "type": "regex",
            "targets": [
                "赋能|抓手|闭环|沉淀|对齐|拉通|落地|链路|打法|颗粒度|方法论|心智|生态|组合拳|护城河|增长飞轮"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "判断目标读者是否需要这些术语；若术语遮住动作，改写为谁在何时做了什么。"
        }
    },
    {
        "id": "lazy-extremes",
        "namespace": "absolute",
        "title": "懒惰绝对词",
        "level": "low",
        "note": "绝对词容易制造虚假的权威感，除非文本能给出明确范围。",
        "detector": {
            "type": "regex",
            "targets": [
                "所有人|每个人|大家都|永远|从来不|一定会|必然|毫无例外|没有人|任何人都"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "补充具体范围、对象或条件；如果无法限定，改成更准确的表达。"
        }
    },
    {
        "id": "adverb-intensifier",
        "namespace": "modifier",
        "title": "过度副词和强化词",
        "level": "low",
        "note": "强化词常用来替代具体程度或证据。",
        "detector": {
            "type": "regex",
            "targets": [
                "非常|十分|极其|特别|高度|深刻地|充分地|有效地|显著地|真正地|完全地|本质上|根本上"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "如果强化词没有提供具体程度，建议删除或改成事实、数字、动作。"
        }
    },
    {
        "id": "quotable-punchline-candidate",
        "namespace": "punchline",
        "title": "金句式收束候选",
        "level": "low",
        "note": "这类句式容易变成可摘录的标语，而不是推进信息。",
        "detector": {
            "type": "regex",
            "targets": [
                "真正的[^。！？\\n]{1,24}|这才是[^。！？\\n]{1,24}|从来不是[^。！？\\n]{1,24}而是"
            ]
        },
        "action": {
            "type": "suggest",
            "message": "判断它是否承担具体信息；若只是姿态，改成具体动作、结果或场景。"
        }
    },
    {
        "id": "hollow-summary-paragraph",
        "namespace": "abstraction.hollow",
        "title": "空泛总结段",
        "level": "medium",
        "note": "段落用抽象价值判断收束，却没有提供新的具体信息。",
        "detector": {
            "type": "llm",
            "prompt": "判断段落是否只是把前文包装成空泛总结，而没有推进事实、情绪、论点或场景。\n\n判断标准：\n1. 如果删掉该句或该段后，信息几乎不变，并且主要由抽象名词、价值判断、宏大词汇组成，应标记为需要修复。\n2. 如果总结压缩了前文并引出下一步、明确立场或形成必要节奏，可以保留。\n3. 小说叙述中，如果它替代了人物行动、感官细节或冲突推进，应标记为需要修复。\n\n请分析上下文，给出修复或保留的判断和理由。"
        },
        "action": {
            "type": "suggest",
            "message": "改成具体结果、动作、情绪变化、论点推进或可观察场景。"
        },
        "examples": [
            {
                "bad": "几次调整之后，事情似乎走向了更开阔的地方。",
                "reason": "句子只给出抽象方向感，没有说明调整带来什么具体变化。"
            },
            {
                "bad": "他把空杯放回桌面，终于明白这场谈判已经结束。",
                "good": "保留",
                "reason": "这句用具体动作和认知变化完成段落收束。"
            }
        ]
    },
    {
        "id": "register-mismatch",
        "namespace": "register",
        "title": "语体错位",
        "level": "medium",
        "note": "文本突然出现与体裁、叙述视角或人物声音不一致的说明书/公文/营销式语气。",
        "detector": {
            "type": "llm",
            "prompt": "判断某句或某段是否与文本体裁、叙述视角、人物声音不一致。\n\n判断标准：\n1. 如果文本是小说、随笔、对话或第一人称体验，却突然出现报告式、教程式、宣传式、课堂总结式语气，应标记为需要修复。\n2. 如果目标文本本来就是说明文、报告、教程、产品文案，且该语体服务于内容，可以保留。\n3. 如果语体变化来自人物设定、讽刺、引用或刻意模仿，可以保留。\n\n请分析上下文，给出修复或保留的判断和理由。"
        },
        "action": {
            "type": "suggest",
            "message": "把语气改回文本体裁、叙述视角或人物声音。"
        },
        "examples": [
            {
                "bad": "她攥紧门把手。这个动作反映了她面对压力时的回避倾向。",
                "reason": "小说叙述突然切换成分析报告语气。"
            },
            {
                "bad": "缓存失效通常来自过期策略、主动清理和写入竞争。",
                "good": "保留",
                "reason": "技术文档中的直接说明，语体匹配。"
            }
        ]
    },
    {
        "id": "monotone-rhythm",
        "namespace": "rhythm",
        "title": "节奏单调",
        "level": "medium",
        "note": "连续句子或段落使用相近长度、相同结构、相同收束方式，读起来像模板。",
        "detector": {
            "type": "llm",
            "prompt": "判断文本是否因为连续句式、句长、段尾收束方式过于相似而显得机械。\n\n判断标准：\n1. 如果连续三句以上使用相近结构或长度，且不是诗性重复、角色口吻或刻意修辞，应标记为需要修复。\n2. 如果每段都用短促总结、抽象拔高或类似句式收尾，应标记为需要修复。\n3. 如果重复服务于节奏、人物心理、诗性回环或论证清晰，可以保留。\n\n请指出重复模式，并建议通过长短句混合、拆并句、改变段尾方式来修复。"
        },
        "action": {
            "type": "suggest",
            "message": "通过长短句混合、拆并句、改变段尾方式来修复。"
        },
        "examples": [
            {
                "bad": "她推开门。她看见灯。她听见雨。她停在原地。",
                "reason": "连续短句结构重复，如果不是刻意节奏会显得机械。"
            },
            {
                "bad": "他等。她也等。门外的雨替他们说完了剩下的话。",
                "good": "保留",
                "reason": "短句重复服务于停滞气氛。"
            }
        ]
    },
    {
        "id": "over-explaining-reader",
        "namespace": "explanation.over",
        "title": "过度解释",
        "level": "medium",
        "note": "文本反复说明读者已经能从事实、动作或上下文中推断出的意思。",
        "detector": {
            "type": "llm",
            "prompt": "判断文本是否替读者解释了已经能从动作、事实或上下文中推断出的内容。\n\n判断标准：\n1. 如果一句话只是解释上一句已经表达清楚的情绪、因果或意义，应标记为需要修复。\n2. 如果解释提供了新信息、关键约束或必要背景，可以保留。\n3. 小说文本中，优先用动作、感官、对话承载情绪；说明文中，必要解释可以保留。\n\n请标出可删除或可压缩的解释，并说明删除后是否损失信息。"
        },
        "action": {
            "type": "suggest",
            "message": "删除或压缩读者已经能推断出的解释，保留新信息和必要约束。"
        },
        "examples": [
            {
                "bad": "他离开了房间。这说明他已经不想继续谈下去了，也意味着这段关系出现了裂痕。",
                "reason": "后一句替读者解释动作含义，且没有提供新信息。"
            },
            {
                "bad": "他离开房间，因为楼下的消防铃响了。",
                "good": "保留",
                "reason": "解释提供了新的因果信息。"
            }
        ]
    },
    {
        "id": "low-specificity",
        "namespace": "specificity.low",
        "title": "缺少具体信息",
        "level": "medium",
        "note": "句子有判断或评价，但缺少事实、行动、对象、时间、结果。",
        "detector": {
            "type": "llm",
            "prompt": "判断文本是否用抽象判断替代了具体信息。\n\n判断标准：\n1. 如果句子说某事重要、有效、复杂、深刻，却没有说明对象、动作、数字、结果或可观察变化，应标记为需要修复。\n2. 如果抽象判断前后已经有足够具体证据，可以保留或轻微压缩。\n3. 如果文本是诗性表达或角色感受，可以保留抽象，但应确认它是否服务于声音和节奏。\n\n请指出缺少的具体信息类型，并给出更具体的改写方向。"
        },
        "action": {
            "type": "suggest",
            "message": "补充事实、行动、对象、时间、数字、结果或可观察变化。"
        },
        "examples": [
            {
                "bad": "这个方案具有很强的可执行性。",
                "reason": "只有评价，没有说明为什么可执行。"
            },
            {
                "bad": "这个方案只需要改两张表，不碰收款代码。",
                "good": "保留",
                "reason": "给出了可执行性的具体理由。"
            }
        ]
    },
    {
        "id": "hidden-actor",
        "namespace": "actor.hidden",
        "title": "隐藏行动者",
        "level": "medium",
        "note": "抽象名词、系统或事物承担人类动作，隐藏了真正做决定或采取行动的人。",
        "detector": {
            "type": "llm",
            "prompt": "判断句子是否让抽象名词或事物承担了本应由人完成的动作。\n\n判断标准：\n1. 如果句子写“决定浮现”“文化改变”“数据告诉我们”“局面推动了...”，但没有说明谁判断、谁决定、谁行动，应标记为需要修复。\n2. 如果无生命主语只是普通比喻，且不影响清晰度，可以保留。\n3. 如果具体行动者未知，可以改成更诚实的表达，而不是强行编造主体。\n\n请优先建议把人、团队、角色或具体机制放回主语位置。"
        },
        "action": {
            "type": "suggest",
            "message": "把真正判断、决定或行动的人、团队、角色或机制放回主语位置。"
        },
        "examples": [
            {
                "bad": "决策逐渐浮现，团队文化发生转变。",
                "reason": "句子隐藏了谁决定、谁改变行为。"
            },
            {
                "bad": "夜色压下来，他终于开口。",
                "good": "保留",
                "reason": "这是文学化环境描写，不是逃避行动者。"
            }
        ]
    },
    {
        "id": "quotable-punchline",
        "namespace": "punchline",
        "title": "金句感",
        "level": "low",
        "note": "句子像社交媒体摘录、标语或段尾 punchline，但没有推动信息。",
        "detector": {
            "type": "llm",
            "prompt": "判断句子是否为了显得有洞察而写成可摘录的金句，却没有承担事实、动作、情绪推进或论证功能。\n\n判断标准：\n1. 如果句子删掉后信息不变，并且主要靠对仗、反转、抽象名词或漂亮收束制造效果，应标记为需要修复。\n2. 如果它确实压缩了前文的具体洞察，或是角色语言、标题、口号场景，可以保留。\n3. 不要只因为一句话好听就标记；关键看它是否替代了内容。\n\n请说明它承担了什么信息，或为什么只是姿态。"
        },
        "action": {
            "type": "suggest",
            "message": "用具体动作、事实、结果、情绪推进或论证功能替代姿态式收束。"
        },
        "examples": [
            {
                "bad": "每一次沉默，都会在时间深处开出答案。",
                "reason": "抽象且像可摘录的标语，没有提供具体情节或判断。"
            },
            {
                "bad": "她第二天又来了，这次带着账本。",
                "good": "保留",
                "reason": "具体动作推进了故事。"
            }
        ]
    },
    {
        "id": "mechanical-elevation-ending",
        "namespace": "ending.elevation",
        "title": "段尾机械升华",
        "level": "medium",
        "note": "段落结尾频繁拔高主题、总结意义或抛出愿景，替代具体推进。",
        "detector": {
            "type": "llm",
            "prompt": "判断文本是否在多个段尾反复使用抽象拔高、愿景、价值判断或主题升华。\n\n判断标准：\n1. 如果每段结尾都升到“意义、可能、未来、成长、时代、价值”等抽象层，且没有新信息，应标记为需要修复。\n2. 如果升华是全文关键收束，且前文已有具体事实支撑，可以保留。\n3. 小说中，如果升华替代了人物动作、环境反馈或冲突推进，应标记为需要修复。\n\n请指出重复的段尾模式，并建议改成具体结果、动作、感官细节或明确判断。"
        },
        "action": {
            "type": "suggest",
            "message": "把段尾改成具体结果、动作、感官细节或明确判断。"
        },
        "examples": [
            {
                "bad": "会议结束后，白板上的三行字还没擦掉。那个夜晚仿佛给团队打开了新的未来。",
                "reason": "段尾从具体会议突然升到抽象未来。"
            },
            {
                "bad": "他把辞职信放进抽屉，锁上了。",
                "good": "保留",
                "reason": "具体动作完成段落收束。"
            }
        ]
    }
] satisfies LintRuleRecord[];

/**
 * 官方默认规则集人工维护规则的聚合入口：核心规则 + 各主题模块。
 * curated-import 仍从这里读取 `DEFAULT_BASE_RULES`，再与中文样本去重合并生成 builtin/default。
 */
export const DEFAULT_BASE_RULES = [
    ...CORE_BASE_RULES,
    ...OPENER_RULES,
    ...INFLATION_RULES,
    ...TRANSITION_SUMMARY_RULES,
    ...ATTRIBUTION_RULES,
    ...ASSISTANT_RULES,
    ...JARGON_RULES,
    ...TRANSLATIONESE_RULES,
    ...TIER2_RULES,
    ...MECHANICAL_RULES,
] satisfies LintRuleRecord[];

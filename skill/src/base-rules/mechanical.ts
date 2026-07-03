import type {LintRuleRecord} from "../types";

/**
 * 机械痕迹规则（mechanical.*）。
 *
 * 取材自 avoid-ai-writing 的通用机械检测器（与语言无关，不是英文字面规则）：
 * 零宽字符、同形字混淆、未填充占位符、聊天机器人引用泄漏。
 * 这些都是高精度、低误杀的「文本里不该有的东西」，AI / humanizer 工具会留下。
 */
export const MECHANICAL_RULES = [
    {
        "id": "mechanical-zero-width",
        "namespace": "mechanical.zero-width",
        "title": "零宽字符",
        "level": "low",
        "note": "零宽空格 / 零宽连接符 / BOM 等不可见字符，正常中文写作不会出现；humanizer 工具常插入它们绕过检测。直接删除。",
        "detector": {
            "type": "regex",
            "targets": [
                "[\\u200B\\u200C\\u200D\\u2060\\uFEFF]"
            ]
        },
        "action": {"type": "replace", "replacements": [""]}
    },
    {
        "id": "mechanical-homoglyph",
        "namespace": "mechanical.homoglyph",
        "title": "拉丁同形字混淆",
        "level": "low",
        "note": "西里尔 / 希腊字母里长得像拉丁字母的同形字（如用西里尔 е 冒充拉丁 e），常见于绕过 AI 检测。确认不是有意的外文引用后，改回正常拉丁字母。",
        "detector": {
            "type": "regex",
            "targets": [
                "[аеорсхукмнвтАЕОРСХУКМНВТіјѕ\\u03BF\\u03B1\\u03C1\\u039F\\u0391\\u03A1]"
            ]
        },
        "action": {"type": "suggest", "message": "若非有意使用外文，把同形字改回对应的拉丁字母；否则保留。"}
    },
    {
        "id": "mechanical-placeholder",
        "namespace": "mechanical.placeholder",
        "title": "未填充占位符",
        "level": "medium",
        "note": "成稿里残留的模板占位符（如 {{...}}、[插入...]、（此处...）），是 AI 生成后忘记填写的痕迹。补全或删除。",
        "detector": {
            "type": "regex",
            "targets": [
                "\\{\\{[^}\\n]{1,40}\\}\\}|\\[(?:插入|填写|此处填?|占位|待补充?|你的[^\\]\\n]{0,8}|姓名|名称|日期|地点|时间|公司名?|产品名?|TODO|FIXME|[A-Za-z][A-Za-z_]{1,20}|[xX]{2,})\\]|（(?:此处|请在此|占位|待补)[^）\\n]{0,15}）"
            ]
        },
        "action": {"type": "suggest", "message": "用真实内容补全占位符，或删除残留模板。"}
    },
    {
        "id": "mechanical-chatbot-artifact",
        "namespace": "mechanical.chatbot-artifact",
        "title": "聊天机器人泄漏标记",
        "level": "medium",
        "note": "复制 AI 输出时带进来的内部标记：ChatGPT 的 contentReference / oaicite、Bing 引用角标、chatgpt utm 参数等。直接删除。",
        "detector": {
            "type": "regex",
            "targets": [
                ":contentReference\\[oaicite[^\\]]*\\](?:\\{[^}]*\\})?|oaicite|turn\\d+(?:search|view|news|image)\\d+|【\\d+†[^】]*】|utm_source=(?:chatgpt|openai)"
            ]
        },
        "action": {"type": "replace", "replacements": [""]}
    }
] satisfies LintRuleRecord[];

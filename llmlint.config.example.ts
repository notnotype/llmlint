// llmlint 配置示例。
//
// 最佳实践：多数项目不需要任何配置——不放 llmlint.config.ts 时默认加载 builtin/default，
// 命名空间策略已调好（AI 痕迹默认进 agent 桶，破折号/比喻/泛词/工程师腔/翻译腔等高误杀类默认进 human 桶）。
//   bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <file>              # 默认只看 agent 桶
//   bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <file> --review human  # 看作者偏好/高误杀类
//   bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <file> --review all     # 看全部命中
//
// 下面是「需要定制时」可用的写法，不是默认必须项：
export default {
    rulesets: [
        "builtin/default",
    ],
    trustedRulesets: [],
    rulesetOverrides: {},
    namespaces: {
        // 普通（非 R18）项目关闭成人词汇检查
        "vocabulary.r18": "off",
        // 不想看商务黑话候选时关掉整类
        "商务黑话": "off",
        // 对象形态：只调整审查受众，不改级别、不禁用（把某类默认移进 agent 桶）
        "jargon.engineer": {review: "agent"},
    },
    rules: {
        "filler-word-actually": "warn",
        "firstly-secondly": "error",
        "filler-lets": "off",
        // 对象形态：同时指定级别与审查受众
        "not-but-structure": {level: "low", review: "agent"},
        // 启用一条默认禁用的规则：必须显式 enabled:true
        "modifier.extreme.example-rule": {enabled: true, level: "medium", review: "human"},
    },
    output: "stylish",
};


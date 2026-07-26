# 完整流程详解

本文档解释 `llmlint` 的依赖门和五步本地闭环：安装依赖、初始化、双路检测、合成报告、修复复测、台账与学习出口。

## 流程概览

```
首次 install 依赖门 → status 初始化门 → check + detect → 静态分级表 + 热区 + 四象限 → 修复并复测一轮 → 台账 + 本地学习建议
```

## 步骤 0：install 依赖门

从 SkillCatalog 的 `location` 取得当前 `SKILL.md` 绝对路径，将父目录记为 `<skill-root>`。尖括号是占位符，执行前必须替换为实际绝对路径。首次使用当前 skill，或依赖合同更新导致 `node_modules` 缺失时，在任何 CLI 命令前运行：

```bash
bun install --cwd "<skill-root>" --frozen-lockfile
```

安装成功后才能执行 `status`；安装失败就停止并报告。依赖已经安装且依赖合同未更新时，不需要在每轮审稿前重复安装。

## 步骤 1：status 初始化门

先运行：

```bash
bun "<skill-root>/bin/llmlint.ts" status --format json
```

`status` 会报告版本、本地初始化状态、固定 `login:"none"`、共享设置、项目配置路径、检测器 space、代理状态和缓存目录。

如果 `initialized:false`，先向用户确认共享档位，再用 `config set` 写用户级 `settings.json`：

```bash
bun "<skill-root>/bin/llmlint.ts" config set sharing.tier stats
bun "<skill-root>/bin/llmlint.ts" config set initialized true
```

`config` 只管理用户级 `settings.json`，不会修改项目级 `llmlint.config.ts`。项目级规则变化必须以 diff 建议形式交用户审批。

## 步骤 2：check + detect

静态检查：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --format json
```

查看全部审查桶：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --review all --format json
```

神经检测：

```bash
bun "<skill-root>/bin/llmlint.ts" detect <files...> --format json
```

`check` 会输出 regex、handler 和 density 的结构化命中。`detect` 会输出每个文件的 `docPAi`、`maxPAi`、chunk span、起始行、P(AI) 与 `cached` 状态。

网络失败时，不把整轮审稿判死。报告失败原因和代理建议：

```bash
bun "<skill-root>/bin/llmlint.ts" config set detector.proxy http://127.0.0.1:7890
```

## 步骤 3：合成报告

报告应面向用户，不直接贴原始 JSON。

### 静态分级表

按 `high / medium / low` 分层，再按 `review` 标记：

| 字段 | 用法 |
|---|---|
| `level` | 严重度与退出码口径。 |
| `review` | `agent` 默认处理；`human` 偏风格/高误杀；`none` 机械或诊断。 |
| `fixability` | `auto` 仅机械修复；`candidate/manual` 需要人或 Agent 判断。 |
| `densityIssues` | 分布指纹，一条代表全文或一段，不是逐处替换。 |
| `Issue.detail` | handler 动态说明，如连续短句数量或连接密度。 |

### 热区表

列出 `detect` 中 `pAi >= 0.85` 的 chunk：

```text
L12-L18  P(AI)=0.921  预览文本...
```

### 四象限

| 规则信号 | 检测热力 | 处理 |
|---|---|---|
| 密集 | 红 | 确认疑难。读上下文，优先交用户确认。 |
| 静默 | 红 | 漏网新规则候选。记录片段和观察，不直接大改。 |
| 密集 | 绿 | 误报候选。保留作者声音或建议 config 覆盖。 |
| 绿 | 绿 | 不打扰。 |

### LLM 语义审查

继续运行：

```bash
bun "<skill-root>/bin/llmlint.ts" show-llm-rules
```

对无法静态定位的规则阅读全文判断。没有候选也要在计划中说明“未发现明显问题”。

### 候选分流

每个候选都归入 **修 / 留 / 问**：确认无功能模板负担才修；承担剧情、人物、节奏、题材或载体功能则留；证据不足或可能改变作者意图则问。规则等级和检测热力决定审查优先级，不替代上下文判断。

## 步骤 4：修复并复测一轮

生成 `.agent/polish-plan.md`，等待用户审批。计划包含：

- 静态命中统计、热区统计和四象限摘要。
- 建议修复、建议保留、需要确认的项目。
- 每项的行号、原文片段、理由和拟改写。

修复默认写入 `.agent/polish-output.md`。只有用户明确要求时才直接改原文件。

执行顺序固定为：先读上下文并确认功能，再按 **删 → 压 → 换** 做最小修改。不能用同义词轮换、模板身体反应、硬拆短句或新增细节来掩盖命中。

复测只跑一轮：

```bash
bun "<skill-root>/bin/llmlint.ts" check .agent/polish-output.md --format json
bun "<skill-root>/bin/llmlint.ts" detect .agent/polish-output.md --format json
```

复测仍有高风险时报告剩余风险，不无限循环。不要为了压低外部检测分数牺牲语义、角色声音或可读性。

## 步骤 5：台账与学习出口

写入 `.agent/llmlint-session.json`，记录本轮事实：

```json
{
    "version": 1,
    "sourceFiles": [],
    "createdAt": "",
    "updatedAt": "",
    "status": "completed",
    "settings": {
        "sharingTier": "stats",
        "login": "none"
    },
    "summary": {
        "staticIssues": 0,
        "densityIssues": 0,
        "hotChunks": 0
    },
    "decisions": [],
    "localConfigSuggestions": []
}
```

`decisions` 记录疑难片段：文件、行号、静态规则、检测热区、用户判定、保留/修复理由。`localConfigSuggestions` 记录建议的 `llmlint.config.ts` diff，例如：

- 某条误报规则：`rules: {"rule-id": "off"}`。
- 某类偏风格命中：`namespaces: {"punctuation.dash": {review: "human"}}`。
- 世界观术语：`ignoreTerms: ["仿佛山海"]`。

未经用户批准，不写项目配置。上传和登录不是本版本能力，只保留后续 contributions 出口说明。

## 规则作者注意事项

- `scope.layer:"narrative"` 使用引号外等长占位视图；引号段被替成等长 `。`，offset 保持原文一致。不要写依赖“数句号”的 narrative regex。
- `scope.layer:"dialogue"` 扫成对引号和 `【】` 面板内文本，适合公告、公文腔和系统台词。
- `density` 是分布问题；门槛是 AND 语义，命中后只能人工/Agent 修，不提供机械替换。
- `ignoreTerms` 是项目级豁免词；regex、density、handler 命中与豁免词区间重叠都会被丢弃。

## 修复原则

详见 [repair-guide.md](repair-guide.md)。简版：

1. 先删无信息负担，再重写必要句子。
2. 先判修 / 留 / 问，再按删 / 压 / 换处理；规则命中和 P(AI) 都不是修改命令。
3. 只改表达，不改剧情、人设和时间线；不能删除有功能的信息，也不新增原文没有的事件或细节。
4. 对白先分类，拿不准就交用户确认。
5. 系统公告和技术说明可以保留载体，但要避免叙述者变成说明书。
6. 不为清零命中或降低分数制造同义词套壳、模板反应和电报体。
7. 每轮有收敛边界，复测一轮后报告剩余风险。

---
name: llmlint
description: Lint and polish LLM-generated Chinese text by combining static rule hits, neural AIGC heatmaps, contextual review, approved repair, and local learning notes. Use when reviewing Markdown or plain text for AI writing tells, naturalness, repetitive patterns, lint rules, repair plans, or llmlint configuration.
---

# llmlint

llmlint 是面向 LLM 输出的文本 lint skill。CLI 负责稳定、可复现的候选定位与外部 AIGC 热力图；Agent 负责结合语境复核、制定修复计划、在用户审批后改写，并把疑难判断沉淀为本地学习出口。

目标不是把规则命中或 P(AI) 清零，而是在守住原文事实、剧情功能、角色声音和文体意图的前提下，减少无功能的模板负担。静态命中和检测热区都是候选证据，不是修改命令。

## Runtime

CLI 用 **Bun** 或 **Node + `tsx`** 运行。先从 SkillCatalog 的 `location` 取得当前 `SKILL.md` 绝对路径，并把它的父目录记为 `<skill-root>`。下文尖括号是占位符，执行前必须替换为实际绝对路径：

```bash
bun "<skill-root>/bin/llmlint.ts" <command>
```

裸 `node` 不能直接跑此 CLI。首次使用当前 skill，或依赖合同更新导致 `node_modules` 缺失时，必须先完成下方依赖门；不要先尝试 `status`，再等缺依赖报错。

## Dependency Gate + Five-Step Loop

### 0. install 依赖门

使用上面从 SkillCatalog 推导出的 `<skill-root>`。在第一次运行任何 llmlint CLI 命令前，必须执行一次：

```bash
bun install --cwd "<skill-root>" --frozen-lockfile
```

安装命令成功后才能进入 `status` 初始化门。依赖已经安装且 skill 未更新时不要每轮重复安装；安装失败时停止本轮 llmlint 流程并向用户报告，不要绕过依赖门改用其它包管理器或让 Bun 隐式补包。

### 1. status 初始化门

每次开始正式审稿前先运行：

```bash
bun "<skill-root>/bin/llmlint.ts" status --format json
```

读取这些字段：
- `initialized`：是否完成本地初始化。
- `login`：当前固定为 `"none"`；本版本不实现登录。
- `sharing`：用户共享档位与自动/询问策略。
- `configPath`：项目级 `llmlint.config.ts` 路径；没有则为 `null`。
- `detector`：神经检测器 space、代理状态、缓存目录。

如果 `initialized:false`：
1. 向用户确认共享档位：`off` / `stats` / `fragments` / `full`。默认建议 `stats` 或按项目约束保守选择 `off`。
2. 说明本版本没有登录，`login` 会保持 `none`。
3. 用户同意后用用户级配置命令写入，不修改项目级 `llmlint.config.ts`：

```bash
bun "<skill-root>/bin/llmlint.ts" config set sharing.tier stats
bun "<skill-root>/bin/llmlint.ts" config set initialized true
```

可查看用户级设置：

```bash
bun "<skill-root>/bin/llmlint.ts" config get
bun "<skill-root>/bin/llmlint.ts" config get detector.proxy
```

`config` 只管理用户级 `settings.json`，不写项目级规则配置。需要调整规则时，由 Agent 生成 `llmlint.config.ts` diff，等待用户审批。

### 2. check + detect 双路检测

先跑静态检查：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --format json
```

需要看全部审查桶时加：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --review all --format json
```

再跑神经检测：

```bash
bun "<skill-root>/bin/llmlint.ts" detect <files...> --format json
```

`detect` 使用默认 HF Space `yuchuantian-aigc-text-detector.hf.space`，按句界分块并缓存正文哈希。网络失败时报告失败原因和代理设置建议；已完成文件的缓存仍可保留。代理可配置：

```bash
bun "<skill-root>/bin/llmlint.ts" config set detector.proxy http://127.0.0.1:7890
```

静态命中不是判决，P(AI) 也不是单独裁决。二者都只是审稿证据。

### 3. 合成报告

把 `check` 与 `detect` 合成一个面向用户的审稿报告：

- 静态分级表：按 `high / medium / low` 和 `review` 桶列出规则命中、密度指纹、handler detail。
- 热区表：列出 `pAi >= 0.85` 的 chunk 行号范围、P(AI)、短预览。
- 四象限交叉：
  - 规则密集 × 热力红：确认疑难，优先读上下文，必要时交用户判定。
  - 规则静默 × 热力红：漏网新规则候选，记录片段和观察，不直接大改。
  - 规则密集 × 热力绿：误报候选，优先保留作者声音或调整规则配置。
  - 双绿：不打扰。
- LLM 语义规则：继续执行 `show-llm-rules`，主动阅读全文审查无法静态定位的问题。

每个候选必须归入三类之一：

- **修**：确认是无功能的模板负担，并给出最小改法。
- **留**：命中承担剧情、人物、节奏、题材或载体功能，说明保留理由。
- **问**：证据不足或修改会改变作者意图，把冲突点交给用户判断。

报告不要输出原始 JSON 给用户。只摘取必要行号、规则、热区和建议。

### 4. 修复 ↔ 复测一轮

生成 `.agent/polish-plan.md`，内容包括：
- 统计和四象限摘要。
- 明确建议修复、建议保留、需要用户确认的项目。
- 每项引用行号、原文片段、修复理由。

等待用户审批后执行修复。默认写入 `.agent/polish-output.md`，只有用户明确要求时才直接修改原文件。

执行每项修复前先读命中前后文，确认它承担的信息、因果、视角和语气。按 **删 → 压 → 换** 处理：先删无信息负担；删后断裂则压缩重复说明；只有必要语义必须保留时才改写。改动限定到解决问题所需的最小范围，不整段重写无关内容。

修复完成后只复测一轮：

```bash
bun "<skill-root>/bin/llmlint.ts" check .agent/polish-output.md --format json
bun "<skill-root>/bin/llmlint.ts" detect .agent/polish-output.md --format json
```

如果复测仍有高风险问题，报告剩余风险，不无限循环。不要为了压低检测分数牺牲语义、角色声音或可读性。

### 5. 台账与学习出口

本轮结束时写入或更新 `.agent/llmlint-session.json`：

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

疑难片段判定要记录：文件、行号、规则/热区证据、用户判定、保留或修复理由、建议的本地 config 覆盖。上传能力不在本版本实现；远端学习出口只说明“待后续 contributions 命令”。

本地学习出口只能给 diff 建议，例如关闭某条误报规则、把某 namespace 移到 human 桶、添加 `ignoreTerms`。未经用户批准，不写 `llmlint.config.ts`。

## Repair Discipline

修复时使用 [repair-guide.md](references/repair-guide.md)：
- 删除优先，先删无信息负担，再重写必要句子。
- 只改表达，不改剧情、人设和时间线；不能删除有功能的信息，也不新增原文没有的事件。
- 对白先分类：保留角色声音，拿不准归入需确认。
- 数据包腔、系统公告、技术说明可以保留载体，但不要让叙述者变成 API 文档。
- 不用同义词轮换、模板身体反应、硬拆短句或新增感官细节掩盖命中。
- 不追求零命中或更低检测分数；修后语义、角色声音和可读性优先。
- 每轮修复有收敛边界，不因检测分数继续无意义打磨。

## Rule Author Notes

- `scope.layer:"narrative"` 扫描的是引号外等长占位视图；引号段呈现为等长 `。`。规则不能依赖“数句号”判断。
- `scope.layer:"dialogue"` 扫描成对引号和 `【】` 面板内文本，适合公告/系统台词。
- `density` 表示分布指纹，命中一条代表全文或一段的统计结论，不能机械替换。
- `ignoreTerms` 是项目级白名单；命中与术语区间重叠会被三种 detector 统一跳过。

## References

- [CLI 详细使用说明](references/cli-usage.md)
- [中文文本润色模式库](references/patterns.md)
- [完整流程详解](references/workflow.md)
- [修复指导](references/repair-guide.md)

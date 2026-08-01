# 多轮修订谱系与数据收集通道（本地优先）

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [Task 23](../23-skill-loop-and-service/README.md)：分片 2（学习闭环/contributions）原规划，本任务由它演化而来
- [web/prisma/schema.prisma](../../../web/prisma/schema.prisma)：Revision / DocJudgment 模型（`wantReadOn` 轴与盲评判定已建成；本任务的谱系设计与它对齐，ETL 映射后置）
- [web/scripts/import-corpus.ts](../../../web/scripts/import-corpus.ts)：语料导入脚本（盲评种子导入的扩展基座，幂等 + 强制 private + 导入同步 MachineScan）
- [skill/SKILL.md](../../../skill/SKILL.md) / [skill/references/workflow.md](../../../skill/references/workflow.md)：依赖门、五步流程与台账 v3
- [skill/src/user-state.ts](../../../skill/src/user-state.ts)：四档共享同意（off/stats/fragments/full + ask/auto）；`contribute` 只导出到本地 outbox，仍无发送通道
- [docs/tasks/03-llmlint-eval-harness/data-acquisition.md](../03-llmlint-eval-harness/data-acquisition.md)：语料合规边界（:47 转公开红线）
- `evals/experiments/guide-arm/` + `evals/experiments/arm-corpus.ts` + `evals/experiments/guide-arm-report/detector-scores.json`：盲评种子数据源（78 对 × 2 臂 = 156 篇，detector 分数已有）

## User Request / Topic

- 为拿到 `wantReadOn` 类人评数据、并用真实使用数据优化 evals，把 skill 发布出去并**走通数据收集**。
- 讨论中的三个关键转向（均用户拍板）：① 收集**本地优先**——先落本地，后端服务起来再接入，web 端点与发送整体后置；② 本轮**重点设计 contribute 的数据形态**；③ 新增**多轮修订本地谱系**（rounds 目录），支持「对修复稿再修一轮」，取代单槽过程产物。
- 调研中发现合规红线已被突破（public 仓历史含 28 篇受版权章节全文），一并处理。
- 记忆系统：确认与 contribute 的职责边界（分清但共管道），下个任务专门设计。

## Goal

skill 端形成「多轮修订谱系 + 修前修后人评 + 按档裁剪导出到本地发件箱」的本地收集闭环。验收口径包括：`contribute` 三档裁剪不变量全绿；真实多轮演练不泄露 stats 自由文本；未来 guide-arm 导入 web 时 arm 不出现在任何客户端字段；public 远端历史 `evals/corpus` 计数为 0。当前只完成本地 round/contribute 闭环，web 导入、发送和服务端 ingest 仍后置；`check` / `fix` / `guide` 现有合同不回归。

## Current State（2026-07-31）

- web 采集站接收面已经存在：`DocJudgment.wantReadOn`（0–5「想不想追更」）、盲评由服务端按 `revealedAt` 裁定、zod DTO、admin 导出和 `import-corpus.ts`；skill → web 通道、发送和服务端 ingest 仍未实现。
- skill 已有四档本地共享设置（默认 `fragments` + `auto`），`round begin`、台账 v3、三档白名单导出、`--auto`、`--list` 已实现。当前严格读取 ledger，精确校验 source/output 集合，full 不完整时降级并写 `degradedReason`，决策无法映射时跳过该轮。
- fragments/full 只保留轮目录安全快照名，stats 不含文件名、正文、片段、理由、评语或配置建议。`detect` 是独立外部正文请求链路，`sharing.off` 不关闭它；远端日志和保留策略不受 llmlint 控制。
- public 远端主历史的 `evals/corpus` 已清理为 0；public fork 与 PR ref 的残留处置仍是仓外动作，未在本轮执行。

### 设计审查核实过的事实（2026-07-27，实施时不必再查）

- 远端 `origin/master` 含 `evals/corpus/` **162 个文件、其中 26 篇 reference**（首版文档写 28，已更正）。
- `evals/report/`、`evals/eval.config.json`、`.env` **从未进入 git 历史**（全历史 `--diff-filter=A` 检索）；64 个待发布提交扫 `sk-` / `hf_` / `ghp_` / `api_key=` 零命中——force push 不会顺带公开密钥。
- llmlint 仓 `.gitignore` 已含 `.agent/`；`git worktree list` 只有主工作区，Phase 0 不存在第二个待处理副本。
- 台账**目前没有任何代码读**（`grep llmlint-session skill/src tests` 为空），所以 v2 → v3 可随意改形；但 contribute 落地后代码开始读它，契约方向就此反转（见 A 节 `round begin`）。
- neuro-book 侧不受 rounds 目录干扰：`server/workspace-files/project-file-index.ts:384` 把 `.git` / `.nbook` / `.agent` 排除在文件索引与 watcher 之外，不会触发变更收件箱或索引。
- detector 缓存 key = `sha256(detector|version|chunkChars|正文).slice(0, 24)`（`evals/detector/scores.ts:22`），**不是**朴素内容哈希；E 节回填必须照抄这四段口径。
- web `texts/[id]/workspace.get.ts:142` 把 `provenanceJson` 原样发往客户端，而 `import-corpus.ts:175` 的 corpusKey 含文件名——guide-arm 文件名以 `-control.md` / `-guide.md` 结尾（见 E 节 arm 泄漏）。

## Decisions / Discussion（已拍板，勿重议；2026-07-27 全部经用户确认）

> 2026-07-27 设计审查：拍板本身全部成立，但实现口径有 10 处修正（标记为「审查修正 ①–⑩」，分散在 A–F 各节）。其中 ①（备份方式无效）、②（多轮链误判）、③（裁剪须白名单）、④（arm 泄漏面）是必改项，实施时以修正后的口径为准。
>
> 同日用户拍板**推翻修正 ⑩**：contribute 在步骤 5 自动执行、行为可配置、默认自动（见 C 节）。consent 的落点改为初始化门而非每轮询问。
>
> 范围拍板：`evals/experiments/` **保留公开**（Phase 0 只清 `evals/corpus`，F.8 待决项就此关闭）；首轮实施做 Phase 0–2，Phase 3/4 另开。

1. **合规**：git filter-repo 从全历史移除 `evals/corpus/` + force push 一次（用户显式授权，仅此一次，不构成先例）；本地语料保留并 gitignore。`evals/experiments/` 为自产 AI 文本，合规、留在 git。
2. **收集本地优先**：本轮不建 web 端点、不实现发送。`contribute` 只落用户级发件箱 `~/.llmlint/outbox/`；`--send`、服务端点、ask/auto 的发送同意、`settings.service.baseUrl` 全部推迟到服务部署轮。
3. **多轮修订谱系**：项目内 `.agent/llmlint/` 收拢 llmlint 全部工作数据（`session.json` + `rounds/NNNN/`）。**作废**第二轮流程测试的「polish-plan/output 单槽」拍板；full 档「仅最新一轮」降级语义随之作废——每轮全文都在盘上，任何轮都可出 full。
4. **人评口径**：修前、修后各问一次 wantReadOn（0–5），修后可附一句评语；**不问 improvementScore**（前后差值已覆盖其信息量；web 盲评侧该轴照旧存在）。拒答记 null、不阻塞流程；如实标非盲。全部存本地。
5. **guide（写作期）不做任何记录/遥测**。
6. **记忆与 contribute 分清职责、共用管道**：事件层 = 台账 rounds/decisions（contribute 的上传原料）；机械记忆 = `llmlint.config.ts`（已有）；文字记忆 = 风格备忘（下个任务设计，步骤 3 前必读、可拼进 guide 输出）。本轮只在信封留 `kind` 扩展位；`contribute` 名字保留（对外贡献 vs 对内记忆，不抢名）。
7. **盲评种子纳入本轮**：guide-arm 78 对导入本地 web private 池盲评，回答 gemini / Opus 5「写短是否变差」与 deepseek 的 D5 第二条件。
8. **服务端将来采用 blob 优先落库**（原始 payload 整存一张表 + 索引列，Task 12 统一模型映射为后置 ETL）——方向定了，本轮不实施。

## Design 设计定稿

### A. 多轮修订谱系（rounds 目录）

```
.agent/llmlint/
    session.json              // 台账 v3（从 .agent/llmlint-session.json 迁入）
    rounds/
        0001/
            source/<basename> // 本轮修前快照（多文件都放这）
            output/<basename> // 本轮修后稿
            plan.md           // 本轮修复计划
        0002/
            ...
```

- **轮号**：台账 round 条目新增显式 `round` 正整数；下一轮号 = max(台账各 `round`, `rounds/` 现有目录号) + 1；目录名四位零填充。孤儿目录（中断轮）占号不复用。
- **快照时机（随审查修正 ⑤ 前移）**：`round begin` 在**步骤 2 跑 check 之前**执行——建目录并把本轮全部输入文件按 basename 复制进 `source/`（此刻内容即修前真相），随后 `check --format json` 直接落进同一个轮目录。首版写的是「步骤 4 修复开工前快照」，但 check JSON 要落盘就必须先有目录，且步骤 2 手上的正文才是真正的「修前」。修复计划写本轮 `plan.md`；修后稿写 `output/<basename>`。用户明确要求直接改原文件时，改完仍须把改后内容快照进 `output/`——谱系完整性优先。
- **多文件**：basename 镜像；按跨平台大小写不敏感键消歧，重名加 `N-` 数字前缀；台账 `sourceFiles` 保留原始路径，导出只使用轮目录安全快照名。
- **中断轮**：只有台账里 `status: "completed"` 的轮参与导出；有目录无台账条目的孤儿轮忽略。
- **多轮链必须显式声明父轮（审查修正 ②）**：台账 round 增 `parentRound: number | null`，Agent 只在「本轮续修上一轮 output」时填。
  - 首版设计靠 `outputHash(N) ≠ sourceHash(N+1)` 推导「用户手改过」，**在多章场景下必然误判**：作者第 1 轮审第 1 章、第 2 轮审第 2 章时两个哈希天然不等，谱系会凭空捏造一条不存在的用户修订边。而小说项目里这才是常态。
  - 修正口径：`parentRound === N` 时才比哈希——不等 = 用户在两轮之间手改过，显影为一条用户修订边；`parentRound === null` 表示另起一篇，不推导任何边。
- **轮目录由代码建，不由提示词拼（审查修正 ⑥）**：新增 `llmlint round begin <files...>` —— 建目录、拷 `source/` 快照、写台账骨架（`round` / `parentRound` / `startedAt` / `sourceFiles` / `settings`）、把轮号打到 stdout。Agent 只负责调命令与填判断类字段，不算轮号、不拼 JSON 骨架。
  - 理由：今天没有任何代码读台账，Agent 写错只是下轮被覆盖；contribute 落地后，轮号算错或快照漏拷会**产出错数据且看不出来**。「contribute 跳过不合格轮」是事后止损，不是约束。
  - 不做 `round finish`：收尾要写的字段（`retest` / `decisions` / `judgment`）本来就是 Agent 的判断产物，用文件编辑追加即可。
- **保留策略**：不自动清理；用户可删旧轮目录；已导出轮删除不影响发件箱（条目自包含）。
- **与 web Revision 模型的映射（ETL 预留，不实施）**：round1.source → rev0(`upload`)；roundN.output → `llm_fix` 修订；roundN+1.source ≠ roundN.output 时中间插一条 `user_fix` 修订。`TransitionKind` 语义与 schema.prisma 一一对应。

### B. 台账 v3（session.json）

- `version: 3`，路径迁至 `.agent/llmlint/session.json`。新增：
  - 顶层 `projectId`：首次创建时生成的随机 UUID，无任何语义，将来服务端按它把同项目多轮分组而不需要看到任何内容。
  - round 条目：`round`（轮号）、`parentRound`（父轮号或 null，见 A 节）、`judgment: {wantReadOnBefore, wantReadOnAfter, comment, blind: false}`（前三项均可 null）。
- **规则命中不入台账，改为落盘原始 JSON（审查修正 ⑤）**：步骤 2 / 4 的 `check --format json` 直接重定向进本轮目录（`rounds/NNNN/check-source.json`、`check-output.json`），contribute 从文件里读命中分布。
  - 理由：命中分布（ruleId → 次数）是本任务最值钱的野外数据，让 Agent 从 JSON 人肉转抄成台账字段等于主动往它里面掺噪声；落盘同时避免「用今天的规则集重算历史轮」的漂移。
  - 台账只留 Agent 的判断产物（`docPAi` / `spread` / `decisions` / `judgment` / `verdict`），凡是能从文件重算的数字都不抄。
- **问询落点（审查修正 ⑦）**：修前那一问放在**步骤 1、跑 check 之前**（「这稿你现在想继续读下去吗 0–5」）；修后问在复测通过后（同问 + 可选一句评语）。首版把修前一问放在步骤 3 报告之后，作者刚读完「你这稿 26 处 AI 味」再打分，前后差值会被工具自身的框架效应系统性放大；挪到步骤 1 零成本，消掉最大的一个混淆。
- **这份自评不满足 D5（写死，防止将来误用）**：`evals/experiments/README.md` 的验收双条件是「检测概率下降 **且** 人评 `wantReadOn` 不降」，那里的人评必须是独立盲评。本任务收的是**作者对自己刚改完的稿子的非盲自评**（`blind: false` 已如实标注），只能作回归监控与弱信号；D5 第二条件的唯一出口是 E 节的盲评通道。
- **v2 旧档不迁移不兼容**：`loadLedger()` 对缺 v3 必要字段或任何非法台账直接失败；单轮快照/决策交叉引用不完整时只跳过该轮并报告原因。不写任何兼容分支。

### C. contribute 信封与裁剪（本轮核心交付）

命令行为：`contribute` 默认 dry-run（列出待导出轮 + 每轮裁剪摘要与字节数）；`--yes` 真写发件箱并在台账 round 打 `contributedAt`；`--round N` 只导指定轮；`--list` 列出发件箱现有条目；`sharing.tier = off` 直接拒绝（连落盘都不做——off 用户的预期是零数据准备）。台账/rounds 按 CWD 解析（与 `check` 相对路径行为一致，Agent 在项目根运行）。

**步骤 5 自动执行，可配置，默认自动（2026-07-27 用户拍板，推翻审查修正 ⑩）**：

- 复用现有 `sharing.mode`（`auto` | `ask`），**默认值从 `ask` 翻成 `auto`**。不新增配置键——`mode` 的语义本来就是「这类数据动作要不要每次问」，服务轮的发送继续复用它。
- consent 的落点是**初始化门**（SKILL.md 步骤 1 已有：`initialized: false` 时把四档念给用户听、用户确认后才写 settings），不是每轮再问一次。相应地 `initialized: false` 时不自动落盘，只提示——这样「用户从没被问过就有了正文拷贝」不会发生。
- 判断放代码不放提示词：新增 `contribute --auto`，Agent 在步骤 5 无脑调用，由 CLI 读 settings 决定落 / 跳过 / 提示待确认。四种结局各打印一行说明：`tier = off` → 不做；`initialized: false` → 不做并提示先过初始化门；`mode = ask` → 不写并提示加 `--yes`；`mode = auto` → 直接写。
- 连带后果：发件箱会自动增长，所以 `--list` 与手动删除说明从「建议」升为**本轮必交付项**（见 D 节）。

信封：

```jsonc
{
    "schema": "llmlint.contribution/1",
    "kind": "review-round",            // 扩展位：将来 "memory-snapshot" 等
    "tier": "stats | fragments | full",
    "createdAt": "2026-07-27T...",
    "projectId": "...",                // 台账随机 UUID，匿名分组键
    "contentHash": "sha256:...",       // 规范化 payload 哈希（不含自身），服务端幂等键
    "sourceHash": "sha256:...",        // 修前正文哈希，匿名关联键
    "outputHash": "sha256:... | null", // output 集合不完整时必须为 null
    "degradedReason": "output-snapshots-incomplete | null",
    "client": {
        "skillVersion": "3.0.0",
        "rulesetHash": "...",          // materialize 后 active 规则集指纹（新增 rulesetFingerprint()）
        "detector": {"space": "...", "version": "...", "chunkChars": 450},
        "login": "none"
    },
    "payload": { /* 按档裁剪的一轮审稿 */ }
}
```

- 哈希口径：正文哈希 = 每文件 CRLF→LF 归一后 utf-8 sha256；多文件按文件名字典序以 `name\0content\0` 拼接后哈希。contentHash = payload stable-stringify 后 sha256。
- `sourceHash` 的意义：**stats 档不含任何原文但带正文哈希**，服务端能把同一篇稿子的多轮串起来而始终不知道内容；哈希不可逆，不构成泄露。

裁剪表（`trimRoundForTier` 纯函数，单测重点）：

| 字段 | stats | fragments | full |
| --- | --- | --- | --- |
| summary / retest（docPAi、spread、命中数、visibleChars、ruleHits） | ✓ | ✓ | ✓ |
| judgment（wantReadOn 修前/修后，blind:false） | ✓ | ✓ | ✓ |
| text 元信息（genre/textType taxonomy 白名单值、字数） | ✓ | ✓ | ✓ |
| sourceFiles | 只传**数量** | 轮目录安全快照名 | 轮目录安全快照名 |
| decisions（片段原文/判定/理由）+ localConfigSuggestions + 评语 | 只传**计数** | ✓ | ✓ |
| 修前/修后全文（读本轮 rounds 目录） | — | — | ✓ |

**裁剪必须是白名单构造（审查修正 ③）**：`trimRoundForTier` 显式挑字段构造新对象，**不是**「复制整轮再删几个字段」。否则将来台账新增的任何字段（下个任务的记忆层几乎一定要加自由文本）都会默认漏进 stats 档。不在白名单里 = 不出现在导出里，默认方向是安全的那一边。

**不变量测试用哨兵（审查修正 ③）**：「不得出现文件名」无法泛化断言——没法 grep「任意文件名」。可实现形式：fixture 里每个自由文本字段填唯一哨兵串（`SENTINEL_FILE_7Q` / `SENTINEL_FRAGMENT_7Q` / `SENTINEL_COMMENT_7Q` / `SENTINEL_BODY_7Q`…），断言 stats 档序列化结果一个哨兵都不含，fragments 档只含本档允许的那几个，full 档才含正文哨兵。

**降级**：full 档正文缺失、残缺或出现额外 output 文件时如实降级 fragments；此时 `outputHash` 必须为 `null`，信封和 dry-run 摘要写 `degradedReason: "output-snapshots-incomplete"`。source 集合缺失/额外文件，或 decision 无法精确映射到 sourceFiles，则该轮不导出、不进入哈希。

### D. 发件箱（outbox）

- 位置：`~/.llmlint/outbox/`（`LLMLINT_HOME` 可覆盖，与 settings 同根）。用户级而非项目级：它是**跨项目的上传队列**，项目删了数据还在；条目自包含（含裁剪后全文快照），不引用项目路径，将来征求发送同意时「看到什么就发什么」。
- 文件名：`{UTC 时间戳（文件系统安全格式）}-{contentHash 前 8}.json`；`sent/` 子目录留给服务轮（发成功后挪入）。
- **只进不出，本轮就要给出口（审查修正 ⑨）**：服务轮无期，而 full 档每条含完整原文快照且不自动清理。本轮一并交付：`contribute --list`（条目、档位、字节数、创建时间）+ 明确的手动删除说明；skill README 隐私小节写一句用户可见的「full 档会把你的正文完整拷进用户主目录 `~/.llmlint/outbox/`，你可以随时删掉整个目录」。

### E. 盲评种子（guide-arm → 本地 web）

- 扩展 `import-corpus.ts`（或平行新脚本，实施时取改动小者）读 `evals/experiments/guide-arm`（复用 `arm-corpus.ts` 读取器）：`Text{originKind: generated, modelKey, visibility: private, consent: false, genParamsJson: {experiment: "guide-arm", pairRef, arm}}`；幂等键沿用 corpusKey 思路。
- **arm 零泄漏不变量（审查修正 ④：泄漏面比首版写的大）**：首版只约束「arm 只进 `genParamsJson` + 核实 UI 不渲染」，但真正的泄漏在别处——已核实 `web/server/api/texts/[id]/workspace.get.ts:142` 把 `provenanceJson` 原样发往客户端，而 `import-corpus.ts:175` 的 `corpusKey = genre/plotId/文件名`，guide-arm 文件名恰恰以 `-control.md` / `-guide.md` 结尾。页面不渲染也没用，开发者工具一眼看到。
  - 口径改写为：**arm 不得出现在任何发往客户端的字段**（`provenanceJson` / `sourceNote` / `genParamsJson` / 列表摘要全算）。
  - 实现：导入 guide-arm 时 corpusKey 改用文件名哈希（幂等性不受影响，`ensureSafeKey` 天然满足）；arm 与 pairRef 只留在服务端不外发的地方或导入日志/本地映射表里。
  - 断言打在 **API 响应**上而不是 UI 上：拉一遍 `texts.get` 与 `workspace.get`，断言响应 JSON 不含 `control` / `guide` 字样。
- **MachineDetect 回填**：从 `guide-arm-report/detector-scores.json` 查 docPAi / chunks 直接写库，省 156 次 HF 重跑；MachineScan 走导入现有同步路径，但只产生 regex+handler span 结果，不执行 density，也不把半套 density 混入 `hitsJson` / `docScore`。
  - join key **不是**朴素内容哈希（审查修正）：`evals/detector/scores.ts:22` 是 `sha256(detector|version|chunkChars|正文).slice(0, 24)`，三个参数取自 detector-scores.json 头部。只按正文哈希查会全部落空。
- 盲评动线：现有 /contribute 盲评 UI（`wantReadOn` 轴，blind 由服务端按 `revealedAt` 判定，客户端不可伪造）。
- **样本量口径（审查修正 ⑧）**：每模型 5 对是**动线冒烟**（验证导入、盲评、落库跑通），不是实验——符号检验 n=5 时最小 p = 0.0625，5/5 全同向也不显著。要真回答 gemini「写短是否变差」与 mimo 的方向问题，需按每模型 15–18 对规划（`evals/experiments/README.md`：n=15 时 12/15 才到 p=0.035），即读 30–36 章、约 10 万字。这个阅读成本预先记进 TODO，别临期变成「再抽点吧」然后无限期悬着。
- **单人自建站的盲评边界**：判分人同时是站点管理员与实验设计者，「盲」只挡界面不给看，挡不住去查库。如实记为已知局限；要硬证据得引入第三方判分人。

### F. 合规清库操作序列

1. `pip install git-filter-repo`；`git status` 确认工作区 clean。
2. **仓外备份（审查修正 ①：首版写法无效）**：`git clone --mirror . ../llmlint-backup.git`（或整个仓库目录复制到仓外）+ `evals/corpus` 整目录复制到仓外。
   - 首版写的 `git branch backup-pre-filter` **保护不了任何东西**：filter-repo 默认重写仓库里所有 ref，那条备份分支会被一起重写成不含 corpus 的版本、SHA 也变；它还会 `reflog expire --expire=now --all` + `gc --prune=now`，把最后的兜底一并清掉。Phase 0 不可逆，回退点必须在仓外。
3. `git filter-repo --path evals/corpus --invert-paths --force`（重写后工作区不再含该目录，remote 配置会被 filter-repo 清掉）。
4. 拷回语料目录；`.gitignore` 加 `evals/corpus/`；重新 `git remote add origin`。
5. `git push --force origin master`（一次性授权）；验证 `git ls-tree -r origin/master --name-only | grep -c "evals/corpus"` = 0。
6. 副作用如实记录：全部提交 SHA 重写（含本地 64 个未推提交，随推顺带发布）；文档/记忆里旧 SHA 引用作废；已克隆副本无法追回；需要彻底清除 GitHub 侧缓存/fork 时联系 GitHub support。
7. `data-acquisition.md:47` 的「仓库私有」表述同步改写为现状。
8. **已拍板（2026-07-27）：`evals/experiments/` 保留公开，不随本次清理移除。** 抽查确认没有逐字长句（跨文件命中的只有专名与《诗经》成句），它们是按受版权章节的 brief 生成的同人物同情节改写——属衍生内容而非无关自产文本，但风险远低于逐字全文，且 guide-arm / delivery-arm 的实验结论要可复现就必须留着语料。filter-repo 只清 `evals/corpus`。

## 实施拆分

- **Phase 0** 合规清库（F）——先于一切代码，独立完成与验证。
- **Phase 1** 项目侧谱系 + 台账 v3 + 提示词改写（A/B；`llmlint round begin` 命令、check JSON 落盘、SKILL.md、workflow.md、cli-usage.md）。
- **Phase 2** contribute 命令 + 发件箱（C/D；`skill/src/contribute.ts` + cli.ts 注册 + `--list` + 白名单裁剪与哨兵不变量测试 + `rulesetFingerprint()`）。
- **Phase 3** 盲评种子导入（E）。
- **Phase 4** 文档回写（本 README、PROJECT-STATUS、skill README「数据共享与隐私」小节按面向用户语言）+ `bun run sync:neuro-book` + neuro-book 根 `bun scripts/cli/sync-user-assets.ts` + 主题化分批 commit + push。

## Verification / Test

- Phase 0：仓外备份存在且可 `git log` 打开；远端树 corpus 计数 0；本地 `guide-compare` 冒烟确认语料仍可读；fresh clone + `bun install --cwd skill --frozen-lockfile` + `--version` 跑通（发布线仍然活着）。
- Phase 1+2 端到端：真实样本走两轮五步（第二轮对第一轮 output 续修，`parentRound` 填 1）→ `rounds/0001`、`0002` 与两份 `check-*.json` 齐备 → `contribute` dry-run 摘要 → `--yes` 三档各导一次 → 发件箱条目字段齐、stats 档哨兵零命中 → 重复导出被 `contributedAt` 拦住 → off 档拒绝 → `--list` 能看到刚写的条目。
  - 另测「另起一篇」：第三轮换一篇正文、`parentRound: null`，确认不产生用户修订边（这是审查修正 ② 的回归点）。
- Phase 3：导入 156 篇；**对 API 响应**断言无 arm 泄漏（含 `provenanceJson`）；盲评一篇落 `DocJudgment` 且 `blind: true`；MachineDetect 回填 156 行（join key 用四段口径）。
- 全量：root typecheck、`bun run test`、`cd web && bun run typecheck`。

## Implementation Walkthrough

### Phase 0 · 合规清库（2026-07-27 已执行）

1. 文档改动先落一个 commit（filter-repo 要求干净工作区）。
2. `pip install git-filter-repo` → 2.47.0。
3. 仓外双备份并**验证非空**：`../llmlint-backup.git`（mirror，75 提交、162 语料文件）+ `../llmlint-corpus-backup`（162 文件）。
4. `git filter-repo --path evals/corpus --invert-paths --force`：0.75 秒重写 75 个提交；工作区语料被一并删除；`origin` 被 filter-repo 清掉（原值 `git@github.com:notnotype/llmlint.git`，SSH）。
5. 拷回语料（162 文件）；`.gitignore` 加 `evals/corpus/` 段并注明原因与「experiments 不受影响」的对照；重新 `git remote add origin`（用回 SSH URL，否则推不动）。
6. `git push --force origin master`：`+ 8771e94...26901bf master -> master (forced update)`。
7. 验证远端：`evals/corpus` 计数 **0**、`reference-` 计数 **0**、`evals/experiments/` 仍在（218 文件）、76 个提交。

**副作用（如实记录）**：

- 全部提交 SHA 重写，本地 64 个未推提交随这次 force push 一并公开。文档与记忆里的旧 SHA（如 `88182d1` / `0c946dc` / `8181f57` / `bf3d1a9`）全部作废。
- filter-repo 会 `reflog expire` + `gc`，本地无回退点——回退只能靠 `../llmlint-backup.git`。
- `master` 的 upstream 跟踪关系被 filter-repo 一并清掉，需要时用 `git branch --set-upstream-to=origin/master`。
- 已克隆的副本无法追回。

**⚠ 残留暴露（未闭合，需仓外动作）**：force push 只能改 `refs/heads/*`，够不到下面两处，语料仍可公开访问：

| 位置 | 现状 | 说明 |
| --- | --- | --- |
| `Eacgh/llmlint`（public fork） | `evals/corpus` 仍在 | 2026-07-14 推送，独立仓库，本仓无权改 |
| `Otirik-handi/llmlint`（public fork） | `evals/corpus` 仍在 | 2026-07-16 推送，同上 |
| `refs/pull/1/head` | 70 个语料文件 / 26 篇 reference | GitHub 托管的 PR ref，push 触及不到 |
| `refs/pull/2/head` | 162 个语料文件 / 26 篇 reference | 同上 |

两个 PR 都已 merged（#1 Eacgh、#2 Otirik-handi）。可选处置：联系 fork 所有者删除或清理各自副本；向 GitHub Support 申请清除 PR ref 与缓存视图。**均属对外动作，未执行，等用户决定。**

### Phase 1–2 · 谱系 + 台账 v3 + contribute（2026-07-27 已实施，未提交）

**新代码**

- `skill/src/round.ts`：台账 v3 类型与读写、`beginRound()`、轮号推导。轮号 = max(台账各 `round`, `rounds/` 现有目录号) + 1，孤儿目录占号不复用；`projectId` 首次 `randomUUID()`；v2 台账直接抛错不迁移。
- `skill/src/contribute.ts`：`trimRoundForTier()` 白名单裁剪、信封构造、`hashTexts()`（CRLF 归一 + 文件名字典序）、`stableStringify()` 定 `contentHash`、`readCheckFacts()` 从落盘 check JSON 统计命中分布、`outboxDir()` / `listOutbox()`。`rulesetFingerprint` 只此一处用，inline 在模块里没抽公共函数。
- `skill/src/cli.ts`：注册 `round begin` 与 `contribute`，逻辑全在模块里，cli 只做参数解析与人话输出（`--auto` 的四种结局在 `contribute()` 里判，不在提示词里）。
- `tests/contribute.test.ts`：9 条用例，含三档哨兵不变量、`--auto` 四结局、重复导出拦截、full 降级、CRLF 哈希归一、v2 台账报错、孤儿目录占号。

**行为变更**

- `sharing.mode` 默认 `ask` → `auto`（`skill/src/user-state.ts`）。只改 `DEFAULT_SETTINGS`，已写死 `ask` 的老配置不受影响。`tests/user-state.test.ts` 两处默认值断言同步。
- 五步流程：步骤 1 加「问修前分 + `round begin`」；步骤 2/4 的 check/detect JSON 重定向进轮目录；步骤 4 的计划与改稿改写进轮目录（删掉「单槽过程产物」整段）；步骤 5 从「追加条目」改成「填完 `round begin` 建好的条目」，末尾跑 `contribute --auto --round <N>`。
- 初始化门话术重写：四档从「会上传什么」改为「会在本机攒下什么」，并明确 full 档等于在用户目录留一份正文副本。该承诺只覆盖 `contribute`；`detect` 的外部正文请求是另一条链路。

**实测（临时项目 + 隔离 `LLMLINT_HOME`，真实 CLI）**

| 验证项 | 结果 |
| --- | --- |
| `round begin` → 目录 + 快照 + 台账骨架 | 通过，打印轮号/目录/父轮 |
| check JSON 落盘 → contribute 统计命中 | 通过（`{cn.a: 2, cn.b: 1}` 口径正确） |
| 三档裁剪 | stats 3601 字节、fragments 4142、full 15940 |
| **stats 档泄漏检查** | 文件名 0 / 片段 0 / 评语 0 / 正文 0 |
| fragments 档 | 有文件名片段评语，无正文 |
| `--auto` 四结局 | off 不做 / 未初始化不做 / ask 只预览 / auto 直接写，各打印一行 |
| 重复导出 | 被 `contributedAt` 拦住 |
| 轮号与父轮 | 孤儿目录 0007 占号 → 下一轮 8；`--parent 99` 报错 |
| **用户修订边推导** | 轮2.source = 轮1.output → 判「无边」；手改 source 后 → 判「有边」。两向都对 |
| 中断轮 | `status: aborted` 被跳过并打印原因 |

**测试**：`typecheck` 绿；`test:vitest` 306 用例 **305 通过 / 1 失败**，唯一失败是既有的 `tests/revision-text-workspace.test.ts`（Task 23 TODO 已记录：硬编码 `not-but-structure` 的 verdict，依赖 gitignore 的 `evals/report/report.json`，与本轮无关，该文件只引 web/server 与 registry.json）；`test:bun` 74 pass / 0 fail。

**与计划的出入**

1. **payload 里没有 genre / textType**。设计的裁剪表写了「text 元信息（genre/textType taxonomy 白名单值）」，但台账里根本没有这两个字段，skill 也从不问题材。要它就得新增一次用户询问——属于scope 扩张，本轮跳过，记进 TODO。
2. **detect JSON 也落盘了**（`detect-source.json` / `detect-output.json`）。设计只写了 check 落盘；detect 一起落是同样的道理且零成本，contribute 暂时不读它，留给将来重算。
3. **skill README 的「数据共享与隐私」小节当时没写**（Phase 4 项）。已在 2026-07-31 v3.0.0 收口中补齐，并明确拆分 `contribute` 与 `detect`。

### v3.0.0 隐私与完整性硬化（2026-07-31）

- `loadLedger()` 现在逐层解析 Ledger、RoundEntry、metrics、retest、judgment、decision：未知键、非法枚举、非有限数字、非规范 UTC 时间戳、非 UUID `projectId` 和不安全 rule ID 均 fail closed；整个 ledger 非法时命令失败。
- 轮级交叉校验采用精确集合：source 必须与 `snapshotNamesForFiles(sourceFiles)` 完全一致；output 只有精确一致才计算 `outputHash` 或进入 full。output 缺失、残缺或额外文件会降级 fragments，并写 `degradedReason:"output-snapshots-incomplete"`。
- 快照名按跨平台大小写不敏感规则消歧，避免 Windows 下 `A.md` / `a.md` 覆盖。decision 先做精确标准化路径匹配，仅 Windows 风格路径允许大小写不敏感回退；无法映射到 sourceFiles 的决策不导出。
- `trimRoundForTier()` 对 summary、retest、decision、checkFacts、文本和所有计数逐字段重建，嵌套对象不会绕过白名单。stats 只含数字、时间、规则/检测器信息、随机 project ID 与 SHA-256；不含文件名、正文、片段、理由、评语或配置建议。fragments/full 只保留轮目录安全快照名。
- 用户目录绝对路径 fixture、大小写重名、缺失/额外快照、未知 decision 文件、full 降级和 `check-multi.visibleChars` 聚合 focused tests 已通过；隔离 CLI 链路 `round begin → dry-run → initialized=true → --auto → --list → 重复导出` 已通过。
- `contribute` 只写本机 outbox，当前没有发送通道；`detect` 是独立外部请求链路，会 POST 未缓存正文块且不发送文件名，`sharing.off` 不关闭它，远端日志/保留策略不受 llmlint 控制。Task 130 解冻后已完成 NeuroBook vendored/runtime 同步与三层哈希对账：三处各 122 个文件，两段差异均为 0。
- **与计划出入**：`round finish` 没做；收尾字段本来就是 Agent 的判断产物，用文件编辑写台账即可。guide-arm 盲评种子导入、服务端 ingest、发送和 ETL 仍后置。

## TODO / Follow-ups

- [x] Phase 0 合规清库 + force push（一次性授权）；只清 `evals/corpus`，`evals/experiments/` 保留公开（F.8 已拍板）。⚠ 残留：两个 public fork 与 `refs/pull/1|2/head` 仍带语料，待用户决定是否联系 fork 所有者 / GitHub Support
- [x] Phase 1 多轮修订谱系（`round begin` + check JSON 落盘）+ 台账 v3 + 提示词改写
- [x] Phase 2 `contribute` 命令 + 发件箱 + `--list` + 白名单裁剪与哨兵不变量测试
- [ ] Phase 3 guide-arm 盲评种子导入 + 用户抽样盲评（5 对/模型 = 动线冒烟）
- [x] Phase 4 收尾：llmlint 本仓文档、完整门禁、Skill validator、隔离首次安装/status、贡献真实 CLI smoke、source → NeuroBook vendored/runtime 同步和三层哈希对账均已完成；提交/push 不在本次授权范围
- [ ] payload 补 genre / textType（需要新增一次用户询问，本轮跳过）
- [ ] 盲评正式样本量（后置）：每模型 15–18 对才够回答 gemini / mimo 的问题，约 10 万字阅读量，需单独排期
- [ ] 服务轮（后置）：web `POST /api/v1/contributions`（blob 优先落库 + 匿名可写 + IP 限流 + 按档 payload 上限）、`contribute --send` + ask/auto 发送同意、`settings.service.baseUrl`、部署宿主与备份策略
- [ ] ETL（后置）：contributions blob → Task 12 统一模型映射（自 Task 23 TODO 迁入；A 节映射表是起点）
- [ ] 记忆系统设计（下个任务）：风格备忘文件、步骤 3 前必读、可拼进 guide 输出；信封 `kind` 已留位
- [ ] guide-arm 盲评配对分析脚本（有数据后再写）

# 多轮修订谱系与数据收集通道（本地优先）

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [Task 23](../23-skill-loop-and-service/README.md)：分片 2（学习闭环/contributions）原规划，本任务由它演化而来
- [web/prisma/schema.prisma](../../../web/prisma/schema.prisma)：Revision / DocJudgment 模型（`wantReadOn` 轴与盲评判定已建成；本任务的谱系设计与它对齐，ETL 映射后置）
- [web/scripts/import-corpus.ts](../../../web/scripts/import-corpus.ts)：语料导入脚本（盲评种子导入的扩展基座，幂等 + 强制 private + 导入同步 MachineScan）
- [skill/SKILL.md](../../../skill/SKILL.md) / [skill/references/workflow.md](../../../skill/references/workflow.md)：五步流程与台账 v2（本任务改写面）
- [skill/src/user-state.ts](../../../skill/src/user-state.ts)：四档共享同意（off/stats/fragments/full + ask/auto）已实现，无导出通道
- [docs/tasks/03-llmlint-eval-harness/data-acquisition.md](../03-llmlint-eval-harness/data-acquisition.md)：语料合规边界（:47 转公开红线）
- `evals/experiments/guide-arm/` + `evals/experiments/arm-corpus.ts` + `evals/experiments/guide-arm-report/detector-scores.json`：盲评种子数据源（78 对 × 2 臂 = 156 篇，detector 分数已有）

## User Request / Topic

- 为拿到 `wantReadOn` 类人评数据、并用真实使用数据优化 evals，把 skill 发布出去并**走通数据收集**。
- 讨论中的三个关键转向（均用户拍板）：① 收集**本地优先**——先落本地，后端服务起来再接入，web 端点与发送整体后置；② 本轮**重点设计 contribute 的数据形态**；③ 新增**多轮修订本地谱系**（rounds 目录），支持「对修复稿再修一轮」，取代单槽过程产物。
- 调研中发现合规红线已被突破（public 仓历史含 28 篇受版权章节全文），一并处理。
- 记忆系统：确认与 contribute 的职责边界（分清但共管道），下个任务专门设计。

## Goal

skill 端形成「多轮修订谱系 + 修前修后人评 + 按档裁剪导出到本地发件箱」的本地收集闭环，verified by：`contribute` 三档裁剪不变量测试全绿；一次真实两轮审稿端到端演练（rounds 目录、台账 v3、发件箱条目齐备，stats 档序列化结果里 grep 不到任何原文/文件名/评语）；guide-arm 156 篇导入本地 web 且 arm 零泄漏、盲评可落 `DocJudgment`；public 远端历史 `evals/corpus` 计数为 0。约束：不建 web 端点、不实现发送、不动记忆系统；`check` / `fix` / `guide` 现有合同不回归。若 filter-repo 清库中途出现意外（备份缺失、远端拒绝），立即停下报告，不自行变通。

## Current State（2026-07-27 调研）

- web 采集站接收面早已建成：`DocJudgment.wantReadOn`（0–5「想不想追更」）、盲评由服务端按 `revealedAt` 裁定（客户端不可伪造）、zod DTO、admin 导出、`import-corpus.ts`。缺的只是 skill → web 通道。
- skill 已有四档共享同意（默认 `fragments` + `ask`），但**无任何导出/上传能力**；台账 v2 只记数字与判定，**不留正文**；`polish-plan.md` / `polish-output.md` 单槽覆盖，第二轮审稿会抹掉第一轮——full 档「仅最新一轮」的降级语义就是这个缺陷逼出来的。
- 仓库已 public（07-16 前已 push），README 有 skills.sh 安装说明，本地领先 origin 64 个提交。**public 历史含 `evals/corpus` 全部 162 文件，其中 26 篇 reference 为受版权章节全文**（已抽查确认）——`data-acquisition.md:47` 的转公开红线已被突破。
- `git-filter-repo` 未安装。

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
- **多文件**：basename 镜像；重名加 `N-` 数字前缀消歧；台账 `sourceFiles` 保留原始路径。
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
- **v2 旧档不迁移不兼容**：contribute 对缺 v3 必要字段的轮打印原因并跳过；Agent 追加时统一写 v3 形态并升 version。不写任何兼容分支。

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
    "outputHash": "sha256:...",        // 修后正文哈希，多轮链边推导用
    "client": {
        "skillVersion": "2.0.1",
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
| sourceFiles | 只传**数量** | 文件名 | 文件名 |
| decisions（片段原文/判定/理由）+ localConfigSuggestions + 评语 | 只传**计数** | ✓ | ✓ |
| 修前/修后全文（读本轮 rounds 目录） | — | — | ✓ |

**裁剪必须是白名单构造（审查修正 ③）**：`trimRoundForTier` 显式挑字段构造新对象，**不是**「复制整轮再删几个字段」。否则将来台账新增的任何字段（下个任务的记忆层几乎一定要加自由文本）都会默认漏进 stats 档。不在白名单里 = 不出现在导出里，默认方向是安全的那一边。

**不变量测试用哨兵（审查修正 ③）**：「不得出现文件名」无法泛化断言——没法 grep「任意文件名」。可实现形式：fixture 里每个自由文本字段填唯一哨兵串（`SENTINEL_FILE_7Q` / `SENTINEL_FRAGMENT_7Q` / `SENTINEL_COMMENT_7Q` / `SENTINEL_BODY_7Q`…），断言 stats 档序列化结果一个哨兵都不含，fragments 档只含本档允许的那几个，full 档才含正文哨兵。

**降级**：full 档正文缺失（用户删了轮目录）时如实降级 fragments，并在 dry-run 摘要与信封里都说明降级原因。

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
- **MachineDetect 回填**：从 `guide-arm-report/detector-scores.json` 查 docPAi / chunks 直接写库，省 156 次 HF 重跑；MachineScan 走导入现有同步计算路径。
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

-（未开始；实施后按 Phase 回写）

## TODO / Follow-ups

- [ ] Phase 0 合规清库 + force push（一次性授权）；只清 `evals/corpus`，`evals/experiments/` 保留公开（F.8 已拍板）
- [ ] Phase 1 多轮修订谱系（`round begin` + check JSON 落盘）+ 台账 v3 + 提示词改写
- [ ] Phase 2 `contribute` 命令 + 发件箱 + `--list` + 白名单裁剪与哨兵不变量测试
- [ ] Phase 3 guide-arm 盲评种子导入 + 用户抽样盲评（5 对/模型 = 动线冒烟）
- [ ] Phase 4 文档回写 + sync 到 neuro-book + 分批提交 + push
- [ ] 盲评正式样本量（后置）：每模型 15–18 对才够回答 gemini / mimo 的问题，约 10 万字阅读量，需单独排期
- [ ] 服务轮（后置）：web `POST /api/v1/contributions`（blob 优先落库 + 匿名可写 + IP 限流 + 按档 payload 上限）、`contribute --send` + ask/auto 发送同意、`settings.service.baseUrl`、部署宿主与备份策略
- [ ] ETL（后置）：contributions blob → Task 12 统一模型映射（自 Task 23 TODO 迁入；A 节映射表是起点）
- [ ] 记忆系统设计（下个任务）：风格备忘文件、步骤 3 前必读、可拼进 guide 输出；信封 `kind` 已留位
- [ ] guide-arm 盲评配对分析脚本（有数据后再写）

# llmlint web

llmlint 的 web 站：**浏览器本地 AI 味检测** + **判定数据（category ③）采集站**。

- 支持配置式鉴权（见下「鉴权」节）：开发环境默认关闭登录，生产默认开启；`/` 重定向到 `/contribute`——唯一「检测」入口；`/rules`（规则数据页，Task 15）、`/report`、`/dataset` 照旧；playground 编辑器迁至 `/playground`（调试用，不进导航）。检测逻辑只在浏览器跑（`ssr:false` + 复用 `../skill/src` 引擎）。
- `/contribute` 免登录承载**版本化检测工作台**（[Task 15](../docs/tasks/15-detection-workbench/README.md)；采集语义与数据模型仍以 [METHODOLOGY §2.3](../evals/METHODOLOGY.md) 五步权威流程与 [Task 13](../docs/tasks/13-web-five-step-flow/README.md) 为准，落位见 Task 15「采集点落位表」）——`draft → workspace → done` 三态：
  - **draft**：上传 + 自报（题材/体裁/作品名，全可选）+ 「我的检测历史」列表（点开恢复到工作台继续）。
  - **workspace**：左=head 编辑器（规则命中高亮、机械修复、diff 审阅）或旧版只读正文；右=三维检测报告、命中列表、持久化 Agent。报告顶部并列规则引擎/外部检测/LLM Agent 三张“AI 痕迹风险”卡，越高越可疑、颜色越偏红；外部与 LLM 可真实取消、失败重试。综合风险按 30%/45%/25% 作为次级参考，缺失通道重新归一。同一线性 Revision lineage 复用一个 Agent Session，选区以引用附件进入 composer，每个 invocation 最多 64 轮，编辑次数没有业务上限。
  - **done**：总结卡。
- 机器信号**一律服务器计算写入**（上传/建修订即扫、先算后藏）；浏览器本地扫描只作行内高亮展示层。
- Agent Harness 通过 `AgentHarnessPort` 接入，唯一实现是公开包 `@notnotype/neuro-agent-harness@0.1.0`。llmlint 提供 Prisma SessionStore、Pi ModelRuntime、Profile、MachineLlmReviewProjector 和 SSE Adapter；Core 不认识 Prisma、Pi 或业务表。
- 采集到的是**判定标签**，喂评测第②层与规则精度，**永不进 lift**（见根 [CONTEXT.md](../CONTEXT.md) 不变量 D1–D5）。
- `/rules`：规则目录页——registry 全部 303 条 regex 规则 join 构建期烘焙的评测统计（verdict 徽标/effectiveLift/两侧命中率，effectiveLift 预排），verdict 筛选 + 搜索 + 行展开详情（正则/示例/lift 明细）+ 分页；评测 report 缺失时降级注明。

## 栈

Nuxt 4（`ssr:false`）+ Nitro server/api · `nuxt-auth-utils`（密封 cookie session）+ 自撸 scrypt · Prisma 7 + libSQL（`file:` SQLite）· zod 4。

## 本地开发

```bash
cd web
bun install
cp .env.example .env          # 按需改 DATABASE_URL / NUXT_AUTH_ENABLED / NUXT_SESSION_PASSWORD
bun run db:init && bun run db:generate   # 手写 SQL 迁移器建库 + 生成 prisma client（绕开 prisma 引擎 Windows 坑）
bun run dev                   # 预烘 registry/report 后起 nuxt dev
```

> **坑：`prisma migrate/generate` 必须能读到 `DATABASE_URL`。** 缺它时 schema engine 会报一个**空的 `Schema engine error`**（不是 schema 本身有问题）。`.env` 里设好即可；CI/一次性命令可 `DATABASE_URL="file:./data.db" bunx prisma migrate dev`。

历史 Agent Session 的一次性硬切使用仓库根命令 `bun run agent:migrate-neuro`。命令会验证公开 Harness 版本和模型配置、创建一致性 SQLite 备份、按 ledger 重建并重跑 analysis，全部成功后才应用删除 `harnessKind` 的 migration；中断后重复运行会从最后成功阶段继续。

## 数据模型（Task 12/13 后）

- `User`：Int 自增 id + authz `role` + 自述 `identityRole`。
- `Text`：**纯信封**（正文在 Revision）。`originKind` 三变体（uploaded/curated/generated）；`declaredProvenance`（uploaded 自述，默认 unknown）；`sourceNote`（作品名）；`genre/pov/textType` 三值配 `*Source` 三来源（curator/user/llm，值空则源空）。
- `Revision`：修订谱系脊。`ordinal`（0=原文）、`parentId` 软指针血缘、`transitionKind`（upload/static_fix/llm_fix/user_fix）、`revealedAt`（机器结果首次揭示时刻，服务器写、幂等；**blind 判定唯一依据**）。
- `DocJudgment`：`@@unique(userId, revisionId)`，四轴全可选至少一项（aiFlavor/wantReadOn/improvementScore/comment）；`improvementScore` 仅对有 parent 的修订合法；整行覆盖语义；`blind` = 写入时 `revealedAt` 仍为 null。
- `SpanAnnotation`：span 挂 revision 坐标（UTF-16），note 原样存（D3）。
- `MachineScan`：llmlint 引擎扫描（`@@unique(revisionId, engineVersion)`，hitsJson + docScore）；`MachineDetect`：外部 AIGC 检测器（HF gradio，服务端异步写；docPAi/maxPAi + chunksJson 热力图槽位）。两者**仅服务器写**。

DTO 校验见 `server/utils/dto.ts`：客户端不可提交 `id`/时间戳/`charCount`/`originKind`/`*Source`/`uploaderId`/`userId`/`blind`——全服务端设；`genre/textType` 白名单单源 `evals/lib/taxonomy.ts`（alias `evals`）。

## 鉴权：配置式登录模式

`NUXT_AUTH_ENABLED` 控制登录：开发环境默认 `false`，生产构建默认 `true`，`.env` 可显式覆盖。

- **登录关闭（开发默认）**：所有请求在 `requireCurrentUser` 身份边界统一映射到 `__llmlint_local_development__` 本地用户，不依赖 Cookie。异步 job 的创建与动态轮询、历史恢复、reveal/machine 等路径始终得到同一 userId；登录/注册入口隐藏，账号端点返回 409。该用户保持普通 user 角色，不绕过 `/api/export` 的 admin 权限。
- **登录开启（生产默认）**：使用 `nuxt-auth-utils` 密封 cookie session；`/contribute` 无用户时跳转登录，所有写库/owner API 均由 handler 的 `requireCurrentUser` 统一守卫。
- **consent 默认勾选**：内网私有部署拍板，上传表单授权开关默认开（仍可手动关闭，DTO 校验不变）。
- **admin env seed**：启动时 `server/plugins/admin-seed.ts` 读 `NUXT_ADMIN_USERNAME` / `NUXT_ADMIN_PASSWORD`（放 gitignored 的 `.env`，绝不进 git）——两者齐备且用户不存在 → 创建 admin；用户已存在 → 仅确保 role=admin、**不覆盖密码**；env 缺省 → 静默跳过。`GET /api/export` 保持 admin-only（本地开发用户与普通注册用户均为 403）。

  ```bash
  # .env 示例（密码用占位符）
  NUXT_AUTH_ENABLED="false"
  NUXT_ADMIN_USERNAME="admin"
  NUXT_ADMIN_PASSWORD="<替换成强密码>"
  ```

## API

- 账号：`POST /api/auth/{register,login,logout}`、`GET /api/auth/me`。登录关闭时 `me` 返回本地开发用户，login/register 返回 409。
- 需用户身份（登录关闭时由统一身份边界提供本地开发用户；登录开启时要求有效 session）：
  - `GET /api/texts` — 检测历史列表（当前用户，含匿名；createdAt 降序、不分页）：`[{textId, preview(sourceNote 优先，否则 rev0 正文压空白前 30 字), createdAt, revisionCount, latestOrdinal, latestDocScore}]`——`latestDocScore` 仅 head 已揭示且有扫描才为数值，否则 null（D2）。
  - `GET /api/texts/:id/workspace` — 工作台一次全量恢复载荷（owner 校验，非本人/不存在一律 404 防枚举）：`{text 信封, revisions[]（ordinal 升序，每版带 scan/detects）, myJudgments[], annotations[]}`；**D2 硬规则**：`revealedAt===null ⇒ scan 恒 null 且 detects 恒 []`。前端 `hydrateWorkspace(payload)`（`app/utils/contribute-workspace.ts` 纯函数）重建全部工作台状态。
  - `POST /api/texts` — 建 Text + rev0 + 同步 MachineScan（先算后藏；响应不带机器结果，D2）+ 异步 detect / LLM 分类补空。
  - `POST /api/revisions` — 建 rev_k（parent 校验同文档 + 归属）+ 同步扫描 + 异步 detect；可带 `provenanceJson`（逐 hunk 规范见 `shared/revision-provenance.ts`）。
  - `POST /api/revisions/:id/reveal` — 显式揭示（`revealedAt` 幂等落时刻），返回 `{scan, detects}`。
  - `GET /api/revisions/:id/machine` — 未揭示 403（D2 服务器强制）；已揭示返回 scan + detects（detect 异步未到为空数组，前端轮询本端点）。
  - Agent Harness：`GET /api/agent/sessions/:id`（snapshot）、`POST .../invoke`、`POST .../abort`、`POST .../retry`、`GET .../events`（SSE 增量）。session/entry/invocation 全部持久化；运行中再次发送返回 409；服务重启把悬空 invocation 标为 interrupted。SSE 使用 `eventEpoch + seq` 游标、500 条 session replay buffer 和 `connected.snapshotRequired` 恢复协议，直接投影 Pi 的 text/thinking/tool/turn 生命周期；只有游标缺口或 terminal 补结果时才刷新 snapshot。同一 Text 的线性 Revision 通过幂等 advance 复用 Session；`AgentSession.revisionId` 是当前指针，每次运行的版本归属以 `AgentInvocation.revisionId` 为准。改写结果不直接落 Revision，只进入前端 diff 审阅。
  - LLM 评审使用版本化 `llm-rules-agent-v6`：规则描述是权威判定标准，Agent 通过 `lint_check/read` 完整检查正文，只通过 `record_rule_hit` 提交高召回命中；最终 evidence 与风险分由服务器从已校验 hits 生成。
  - Optimize 使用 `repair-agent-v5`。普通消息可自由选择 `read`、`get_revision_detections`、`lint_check`、`lint_fix`、`edit`；一键修到底先由宿主把当前 `fixability:auto` 命中作为 static provenance 应用到草稿，再以更新后的正文发送 `objective=polish_ai_risk`，该 Invocation 不向模型暴露 `lint_fix`。`lint_check` 为命中附加判别力策略：strong 与当前启用的 `vocabulary.*` 必修，weak 和 LLM Review 结合语境处理；eval report 缺失时非词汇规则降级为 contextual，敏感词必修合同不变。`finish` 只守必修集合，不再要求所有规则清零。高风险句段允许句子/段落级小范围润色。
  - 从检测历史恢复工作台不会隐式 reveal 或启动 Agent；跨篇恢复先清空上一 Session 的本地 aborting 状态，再按新 Session active Invocation ID abort。未揭示 head 保持只读，并在版本条显示“继续检测”显式入口。
  - 外部检测 run：`POST /api/revisions/:id/detector-runs` 创建新 attempt；`DELETE /api/detector-runs/:id` 通过 AbortSignal 真正取消 HTTP/SSE 请求。旧 attempt 保留为历史事实。
  - `POST /api/judgments` — 四轴可选判定，blind 按 revealedAt 重算。
  - `POST /api/annotations` — span 标注。
- 需 admin：`GET /api/export`（dump 谱系 + 拆分机器表 + byEngineVersion 索引，喂回 Task 03）。

## 构建期预烘

- `scripts/build-registry.ts` → `app/data/registry.json`：规则 + `engineVersion`（包版本+规则内容 hash，服务端 MachineScan 落库同源）+ `ruleVerdicts` + 版本化 **`creativeProfile`**。`creative-writing@1` 在构建期消费 `evals/report/report.json`：排除 noise/anti 与稳定重复规则，并为排除项记录原因和 canonical rule；report 缺失时保留全量 verdict 候选，但重复规则抑制仍生效。服务端 LLM 改写直接消费 `creativeProfile.includedRuleIds`，不再自行解释 verdict。MachineScan/raw eval 与规则页仍保留完整规则超集。机械修复只吃真正的 `fixability:auto`；默认 semantic replace 为 manual。
- `scripts/build-registry.ts` 同次 → `app/data/rules-report.json`（Task 15，gitignored）：per-rule 全量判别统计（verdict/effectiveLift/两侧命中率/配对明细/byModel/byGenre，已按 effectiveLift 预排），供 `/rules` 页按 ruleId join 规则本体；report 缺失时写空降级产物（`source: null, rules: []`），页面据此注明评测数据缺失。
- `scripts/build-report.ts` → `public/report.json`：报告页内置示例。

## 部署

`bun run build` + Node 宿主（脱离纯静态 GitHub Pages；宿主与 DB 备份策略待定）。生产默认启用登录，必须设强 `NUXT_SESSION_PASSWORD` 与持久化 `DATABASE_URL`；只在明确的受信开发/内网环境设置 `NUXT_AUTH_ENABLED=false`。需要 admin（`/api/export`）时另设 `NUXT_ADMIN_USERNAME` / `NUXT_ADMIN_PASSWORD`（见「鉴权」节）。

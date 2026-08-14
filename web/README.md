# llmlint web

llmlint 的 Web 站包含浏览器本地规则高亮、检测工作台和判定数据采集。生产部署是独立 Node/Nitro 服务，不再发布 GitHub Pages 静态采集站。

- 支持配置式鉴权（见下「鉴权」节）：生产使用 NeuroBook 官方 OAuth SSO；`/` 重定向到 `/contribute`，`/rules`、`/report`、`/dataset` 照旧；playground 编辑器迁至 `/playground`（调试用，不进导航）。
- `/contribute` 承载版本化检测工作台；机器信号由服务器计算并在盲评后揭示，浏览器本地扫描只作行内高亮展示层。
- 采集到的是判定标签，喂评测第②层与规则精度，永不进 lift。

## 栈

Nuxt 4（`ssr:false`）+ Nitro server/api · `nuxt-auth-utils`（密封 cookie session）+ 自有 scrypt hash · Prisma 7 + libSQL（`file:` SQLite）· zod 4。
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
- `MachineScan`：llmlint regex+handler span 扫描（`@@unique(revisionId, engineVersion)`，hitsJson + docScore；当前不含 density）；`MachineDetect`：外部 AIGC 检测器（HF gradio，服务端异步写；docPAi/maxPAi + chunksJson 热力图槽位）。两者**仅服务器写**。

DTO 校验见 `server/utils/dto.ts`：客户端不可提交 `id`/时间戳/`charCount`/`originKind`/`*Source`/`uploaderId`/`userId`/`blind`——全服务端设；`genre/textType` 白名单单源 `evals/lib/taxonomy.ts`（alias `evals`）。

## 鉴权：NeuroBook OAuth SSO

`NUXT_AUTH_ENABLED` 控制 llmlint 自有 sealed session：开发环境默认 `false`，生产环境必须开启。生产不提供本地密码登录、注册或 admin seed；唯一浏览器登录入口是 NeuroBook 官方 OAuth 2.0 Authorization Code + S256 PKCE。

- **登录关闭（仅本地开发）**：请求在 `requireCurrentUser` 身份边界统一映射到 `__llmlint_local_development__`，不依赖 Cookie；SSO start 返回 503，不降级到密码登录。
- **登录开启（生产）**：llmlint 使用 host-only `llmlint-session` sealed cookie；callback 只兑换一次短时 opaque access token、只调用一次官方 `/userinfo`，随后丢弃 token 并建立本地 session。llmlint 不读取官方 Cookie，不保存 ID token/refresh token，不共享 SQLite。
- **用户映射**：官方用户 ID 写入 nullable `User.neuroBookUserId`，本地自增 `User.id` 与历史评分/文本外键保持不变；username 冲突返回 `account_mapping_conflict`，不自动合并。
- **管理员**：只有 `NUXT_NEUROBOOK_ADMIN_USER_ID` 精确匹配官方用户 ID 的首次 SSO 账号获得 admin；既有本地账号和其外键不迁移。

### t133 部署边界

官方 OAuth provider migration 在 nbook 生产容器完成前，llmlint 不应启用生产 SSO。正式切换顺序固定为：官方站升级并确认 `/.well-known/oauth-authorization-server` 返回 OAuth JSON → 以 stdin 初始化 `llmlint-web` client → 将同一 secret 写入 `/srv/llmlint/secrets/web.env` → 启动并检查 llmlint systemd/Nginx/TLS → 使用真实浏览器回调验证 SSO。


## API

- 账号：`GET /api/auth/me`、`POST /api/auth/logout`、`GET /api/auth/neurobook/start` 和 callback `/auth/neurobook`。生产登录只走 NeuroBook SSO；不会提供本地密码 login/register 接口。
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

- `scripts/build-registry.ts` → `app/data/registry.json`：完整规则 catalog + 默认 active 的分类型列表 + `engineVersion`（包版本+规则内容 hash，服务端 MachineScan 落库同源）+ `ruleVerdicts` + 版本化 **`creativeProfile`**。`creative-writing@1` 在构建期消费 `evals/report/report.json`：排除 noise/anti 与稳定重复规则，并为排除项记录原因和 canonical rule；report 缺失时保留全量 verdict 候选，但重复规则抑制仍生效。服务端 LLM 改写直接消费 `creativeProfile.includedRuleIds`，不再自行解释 verdict。规则页与 raw eval 保留完整规则超集；MachineScan 只消费其中的 regex+handler span 子集。机械修复只吃真正的 `fixability:auto`；默认 semantic replace 为 manual。
- `scripts/build-registry.ts` 同次 → `app/data/rules-report.json`（Task 15，gitignored）：per-rule 全量判别统计（verdict/effectiveLift/两侧命中率/配对明细/byModel/byGenre，已按 effectiveLift 预排），供 `/rules` 页按 ruleId join 规则本体；report 缺失时写空降级产物（`source: null, rules: []`），页面据此注明评测数据缺失。
- `scripts/build-report.ts` → `public/report.json`：报告页内置示例。

## 部署

生产部署使用 Nuxt `node-server` 产物和 Node 宿主，不读取构建机或仓库中的 `web/.env`。构建与启动：

```bash
cd web
bun run build
NODE_ENV=production \
DATABASE_URL="file:/绝对路径/llmlint/data/data.db" \
NITRO_HOST=127.0.0.1 \
NITRO_PORT=3020 \
NUXT_AUTH_ENABLED=true \
NUXT_SESSION_PASSWORD="<至少 32 字符的随机密钥>" \
NUXT_NEUROBOOK_OAUTH_ENABLED=true \
NUXT_NEUROBOOK_OAUTH_ISSUER="https://nbook.notnotype.com" \
NUXT_NEUROBOOK_OAUTH_CLIENT_ID="llmlint-web" \
NUXT_NEUROBOOK_OAUTH_CLIENT_SECRET="<部署机 secret>" \
NUXT_NEUROBOOK_OAUTH_REDIRECT_URI="https://llmlint.notnotype.com/auth/neurobook" \
NUXT_NEUROBOOK_ADMIN_USER_ID="1" \
node .output/server/index.mjs
```

`bun run start` 等价于 `node .output/server/index.mjs`；生产不能依赖 `web/.env` 自动加载，环境变量必须由 systemd 或其他宿主注入。OAuth client secret 和 session password 不进入仓库、命令参数、日志或截图。

启动后用 `GET /api/health` 验收，成功 JSON 精确为 `{"status":"ok","service":"llmlint-web","database":"ok"}`；数据库不可用时返回 HTTP 503 且不泄露连接串或文件路径。

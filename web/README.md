# llmlint web

llmlint 的 web 站：**浏览器本地 AI 味检测** + **判定数据（category ③）采集站**。

- 检测 / `/report` / `/dataset` 公开，检测逻辑只在浏览器跑（`ssr:false` + 复用 `../skill/src` 引擎）。
- `/contribute` 与写库 API 需登录：注册用户上传正文 → 盲评两轴 → 揭示报告 → span 自然语言标注 → 落库。
- 采集到的是**判定标签**，喂评测第②层与规则精度，**永不进 lift**（见根 [CONTEXT.md](../CONTEXT.md) 不变量 D1–D4、[Task 06](../docs/tasks/06-web-data-collection/README.md)）。

## 栈

Nuxt 4（`ssr:false`）+ Nitro server/api · `nuxt-auth-utils`（密封 cookie session）+ 自撸 scrypt · Prisma 7 + libSQL（`file:` SQLite）· zod 4。

## 本地开发

```bash
cd web
bun install
cp .env.example .env          # 按需改 DATABASE_URL / NUXT_SESSION_PASSWORD
bunx prisma migrate dev       # 建库（必须先有 DATABASE_URL，见下）
bun run dev                   # 预烘 registry/report 后起 nuxt dev
```

> **坑：`prisma migrate/generate` 必须能读到 `DATABASE_URL`。** 缺它时 schema engine 会报一个**空的 `Schema engine error`**（不是 schema 本身有问题）。`.env` 里设好即可；CI/一次性命令可 `DATABASE_URL="file:./data.db" bunx prisma migrate dev`。

## 数据模型

`User`（Int 自增 id + authz `role` + 自述 `identityRole`）· `Text` · `DocJudgment`（`@@unique([userId,textId,phase])`）· `SpanAnnotation` · `MachineRecord`（含 `engineVersion`）。DTO 校验见 `server/utils/dto.ts`，客户端**不可**提交 `id`/时间戳/`charCount`/`origin`/`uploaderId`/`userId`/`phase`/`blind`——全服务端设。

## API

- 公开：`POST /api/auth/{register,login,logout}`、`GET /api/auth/me`。
- 需登录（`/contribute` 页 + 写库）：`POST /api/{texts,judgments,scans,annotations}`。
- 需 admin：`GET /api/export`（dump 四类实体，按 `engineVersion` 分组，喂回 Task 03）。

导出下游、后续 TODO（LLM 分类、post-edit、众评、注册限流等）见 [Task 06](../docs/tasks/06-web-data-collection/README.md)。

## 部署

`bun run build` + Node 宿主（脱离纯静态 GitHub Pages；宿主与 DB 备份策略待定）。生产必须设强 `NUXT_SESSION_PASSWORD` 与持久化 `DATABASE_URL`。

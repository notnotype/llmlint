# Round 02 — M2 eval-writer(render)+ 首条真实 lift（2026-06-30）

> 计划已审批（M2 稿）。本轮在 `evals/generator/` 搭会调真实模型的测试环境,用本地 config 两个模型照 brief 生成 render,跑出第一张真实 lift。当时评测语料按本地私有资产处理；当前 git 边界见 [Task 04](../../04-llmlint-standalone-repo/README.md)。

## 做了什么

### 生成侧 generator（`evals/generator/`）
- `config.ts`：读本地 `config.json`（含 provider/apiKey，属仓库外私有配置）,`resolveModel(modelKey)` → `{providerId, modelId, baseURL, apiKey, compat}`。provider 数组按 id 查;`xiaomi-token-plan-cn` 注入特殊 compat `{supportsDeveloperRole:false, maxTokensField:"max_tokens"}`。
- `model-client.ts`：**复用 pi-ai `completeSimple`**（单次非流式）。只 import `@earendil-works/pi-ai`,不碰任何服务端模块。`smokeCheck` 验连通。
- `brief.ts`：`BRIEF_SYSTEM`（v1,固定）抽剧情纲——**只剧情骨架,严禁文风/描写/句子**。
- `render.ts`：`RENDER_SYSTEM`（v1,固定）照 brief + 题材 + 目标字数写正文,**不喂文风范本**（最原始 AI 嗓音）。
- `generate.ts`：CLI——遍历题组,缺 brief 就抽,两模型各 render,写 `render-<slug>.md` + merge meta(`role:render, model, difficulty:raw`)。

### 目标模型（config）
- `xiaomi-token-plan-cn/mimo-v2.5-pro`、`deepseek/deepseek-v4-flash`（默认两个）；抽取器默认 mimo。

## 验证结果

- **连通 smoke**：mimo 4202ms「ok」、deepseek-v4-flash 1126ms「ok.」→ pi-ai 整链路（自动注册 provider、compat、completeSimple、取文本、网络）全通。
- **brief**：`light-novel/villain-loli` 抽出 336 字纯剧情纲（题材视角/人物/节拍/信息控制,无文风泄漏）。
- **render**：mimo 3122/2592 字、deepseek 2188/2658 字（reference 2024 字,量级相当）；正文连贯,自带 AI 味（破折号+比喻+感官堆砌）。
- **首条真实 lift**（2 题组 / 10 reference / 4 render,同 brief 配对）：
  - **ROC-AUC 1.000**；docScore 中位 人类 21.26 vs AI 46.68（~2.2×）。
  - **模型排名**：deepseek-v4-flash 40.11（更像人）< mimo-v2.5-pro 56.75。
  - **强判别**：`modifier.measure.*` 4.4、`regex.advanced.empty-quantifier`(某种) 4.2、`proliferation.mixed.repeated-de-pairs` 4.08、**`punctuation.dash.dash-alone-to-comma` 3.30**（人类 0.38 vs AI 2.39）。
  - `proliferation.mixed.extra-punctuation`：人类 5.14 vs AI 10.0,lift 1.86 → **解答早先疑问:弱判别,非纯噪声**。

## 关键发现（喂 Task 02）

- **最强判别器多在 human 桶**：`modifier.measure`、`repeated-de-pairs`、破折号、`metaphor.*`、`low-information-degree` lift 高但 `review:human`,默认 `check` 对 Agent 不可见。这次是**真 AI-vs-人数据**的实证（与 round-01 fixture、早期手测 4-tell 一致）→ Task 02 应据此把这些上调到 agent 桶或重审路由。
- 反指标 3 条（人类>AI，lift<0.67）：人类用得比 AI 多,修了有害,Task 02 应降级/删。

## 计划出入 / 局限

- 样本小（2 题组、4 render），AUC=1.0 是清晰分离的小样本结果,**方向可信但需 M3 扩量 + holdout 才稳**,不可当统计结论。
- render 只用 reference-0001 的 brief（每组 5 reference 当人类类、2 render 当 AI 类）；对风格判别足够,M3 可每章抽 brief 增样。
- mimo 既抽 brief 又 render,有轻微自我对齐 bias（记录在案,M3 可换 extractor）。
- pi-ai `completeSimple` 直接可用,无需手动注册 builtins。
- 未跑全仓 typecheck（本地工具,smoke + 真实 lift 即验证）。

## Follow-ups

- M3：扩题材/题组/模型 + 文风预设档 + holdout;统计显著后把规则体检表正式交 Task 02。
- M4：repair + critic。M5：LLM 规则判别（register-mismatch 等需 LLM judge）。

# Eval 生成管线硬化 + 外部检测器接入 + reference 扩量（小验证轮）

> 本文是交给实现 agent 的**实现计划 + goal**，实现过程按 walkthrough 规则持续更新本文件。
> 权威规范：[../../../CONTEXT.md](../../../CONTEXT.md)（术语 + 不变量 I1–I11/D1–D5，本任务重点 I1/I2/I3/I8，另 **I10** 新增 CLI 也要 cwd 无关、**I11** 新语料同合规边界）、[../../../evals/METHODOLOGY.md](../../../evals/METHODOLOGY.md)（流程，代码按它实现）。

## User Request / Topic

四环体系（CONTEXT §1）落地后的第一批代码活：**环 ① 规则选择的全链路硬化**。用户点名的昂贵/脆弱点：

1. LLM 生成 render 最贵最脆弱——接口会坏；好在一个 brief × 一个模型只需生成一次、永久复用 → **恢复/重试必须可靠**。
2. web 数据（环 ②）慢慢补充，本轮不做。
3. 灵活 CLI 接口，用 **commander**。
4. **配置化**：AIGC 检测接口必须可换。
5. LLM 接口要有**限流、重试配置**。
6. **数据管理要调研建模**：小说 reference 的题材等元数据后续要用。
7. **token 预算**：render 前预估用量、render 后实报用量。
8. 提示词工程：**brief 抽取 prompt、抽取模型、render prompt 都要可配置**。

## Goal（给实现 agent 的一句话指令）

> 在 llmlint 仓 `evals/` 上实现：① calibre 批转 mobi + reference catalog 建模 + 2–3 个新题组入 corpus；② generator 硬化（commander CLI、eval 配置文件、prompt 版本化注册表、`claude -p`/`codex exec` CLI transport、按 provider 限流、token 预算预估/实报）；③ 可换的外部 AIGC 检测器 client（首个实现 = HF yuchuantian/AIGC_text_detector）+ 批量打分 + report 外部对照节；④ 跑一轮小验证（2–3 新题组 × 4–6 模型，含 ≥1 个 CLI 模型）出 report。全程遵守 CONTEXT 不变量（尤其 I8 prompt 版本纪律），贵结果（render/detector 分）一律落盘可续跑。

## 已锁决策（用户拍板）

| 决策 | 内容 |
|---|---|
| 本轮规模 | **小验证轮**：2–3 个新题组 × 4–6 模型（先验证工具链，避免未验证就上量翻车重跑） |
| mobi 处理 | calibre 已装 `C:\Program Files\Calibre2\ebook-convert.exe`，批转 epub 后走现有 epub 摄入 |
| catalog 位置 | **数据旁**：`C:\Users\notnotype\Documents\CodeRepository\GithubProjects\neuro-book\datasets\aigc-detection\catalog.json`（llmlint evals 通过配置 `datasetsRoot` 跨仓读） |
| CLI 模型用途 | 默认只进 **render 面板**（造 AI 样本）；brief 抽取器仍用 HTTP 模型（CLI 慢、无 usage） |
| detector 本轮角色 | **eval 侧批量打分 + 报告对照**（reference 应低分 / render 应高分 = 外部效度）；web 端接入后置 |
| prompt 配置化 × I8 | prompt 做成**带版本 key 的 preset 注册表**（如 `brief-v2`、`render-v1`），meta.json 记 `promptVersion`；跨版本语料不混同一张报告 |

## 资源清单

- **reference 数据集**：`neuro-book/datasets/aigc-detection/`，**精选 100 本**（`books/` 约 667MB，金庸武侠约 40 本 mobi、网文经典 epub/txt），多作者多题材、基本 pre-2023（满足 I6）。**已有元数据**：`manifest.tsv`（100 行：排名/书名/作者/题材/知名度/文笔剧情分/入选理由/仓内路径/sha256）、`source-selected-100.tsv`、`to-supplement.tsv`、README（生成口径）。⚠ `007-诡秘之主` 已是现有题组种子，**新题组避开**，选不同作者不同题材（如：武侠金庸 / 宫斗甄嬛传 / 历史庆余年 / 无限流无限恐怖）。
- **AIGC 检测接口**：https://huggingface.co/spaces/yuchuantian/AIGC_text_detector 。**API 已实测（2026-07-03 smoke）**：
  - 协议：gradio 5.7.1，`POST https://yuchuantian-aigc-text-detector.hf.space/gradio_api/call/predict_zh` body `{"data":["文本"]}` → `{event_id}` → `GET .../predict_zh/{event_id}`（SSE），返回 `["AI"|"人类", 该标签置信度]`。**归一化**：标签=人类时 `P(AI)=1−prob`。
  - 端点 6 个：`predict_zh`（中文-V3，主用）/ `predict_zh4`（中文-V3-短文本）/ `predict_zh6`（中文-V2）+ 英文对应三个。
  - **静默截断已证实**：2173 字末尾追加 216 字 AI 段，分数与不加完全一致（16 位小数）；同段放开头分数 0.54→0.9998 → **只读前部窗口，超长不报错但尾部不可见**。窗口 >500 字、≤2173 字，确切边界 M3 用二分 smoke 钉死。
  - **域偏移警示**：真人类轻小说章节整篇被判 AI 0.537（前 500 字判人类 0.647）——该检测器在中文网文域噪声不小，恰是 M3 外部对照节要量化的东西；也再证 D5"检测器是仪表不是真值"。
  - 实测 2–7 秒/次（本轮无冷启动）；免费实例仍需重试 + 限速 + 可换。
- **LLM HTTP**：neuro-book `workspace/.nbook/config.json` 已有 10 个 provider（bailian/deepseek/doubao/elysiver×4/lyclaude/siliconflow/xiaomi）；qwen3.7-plus、kimi-k2.6、MiniMax-M2.5 等新 id 靠现有"发现放行"机制直接可用。
- **LLM CLI**：anyrouter（key 见 llmlint `.agent/llm_api.txt`，**已 gitignore，严禁进 git/文档**）——claude 系走 `claude -p`、gpt-5.5 走 `codex exec`（env：`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`、`CODEX_API_KEY`）。

## 现有底子（不要重建）

`evals/generator/model-client.ts` 已有：`callWithRetry` + `classifyOutcome`（429/5xx/超时→retry，terminal→跳篇）、`AbortSignal.timeout` 墙钟硬超时、pi-ai HTTP 层重试；`generate.ts` 已有断点续跑（brief/render 文件存在即跳过）、逐篇 try/catch、`--list-models` 模型发现；`config.ts` 已有跨仓读 config.json、模型 id 放行、compat 标志。**CLI transport 必须插进同一个 classifyOutcome/callWithRetry seam**，不要另起炉灶。

## 里程碑

### M1 数据摄入 + catalog 建模
- **第 0 步（合规，I11）**：`datasets/aigc-detection/books/` 是 104 本版权书，在 neuro-book 仓当前 untracked——先把 `datasets/aigc-detection/books/` 加进 **neuro-book** `.gitignore`（catalog.json 是元数据，可进 git）。
- `evals/acquire/calibre.ts`：`ebook-convert` 包装（mobi→epub，批量、幂等：目标存在跳过）。⚠ 中文书名路径 + Windows spawn 编码，用数组参数 spawn、不拼 shell 字符串。
- **catalog = curation 状态层，不重复 manifest**（本条即用户说的"数据管理调研建模"）：书目身份（title/author/genre/评分/sha256）**以既有 `manifest.tsv` 为真相源**，不复制；新建 `catalog.json` 只记 curation 状态，按 `dataset_relative_path`（或 sha256）引用 manifest 行：`{ref, status(raw/converted/segmented/curated), convertedPath?, pubYear?, pov?, selectedChapters?[], notes?}`。manifest 的中文题材标签（如"经典武侠"）与 CONTEXT Genre 枚举做一次映射表（enumOrString 兼容）。
- acquire 吃转换产物 → 清洗/切章 → **agent 产出候选清单**（题组候选书 + 建议章节 + 每章摘录预览），**交用户确认后**才入 `evals/corpus/`（人工质量闸门保留，交互协议 = 一次清单确认），meta 带 `referenceSource/pubYear/author`。

### M2 generator 硬化
- **配置双文件**：`evals/eval.config.json`（真实配置，**gitignore**，可含密钥/env 值）+ `evals/eval.config.example.json`（无密钥，进 git；沿仓里 `llmlint.config.example.ts` 先例）。内容：render 面板、抽取器、prompt 版本选择、per-provider 限流 + **重试参数（maxAttempts/退避基数——现为代码常量，提为配置）**、datasetsRoot、detector 配置（端点/chunkChars/聚合方式）。CLI flag > config > 默认。
- `evals/generator/prompts.ts`：preset 注册表（现 brief.ts v2 / render.ts v1 的 prompt 移入，带版本 key）；meta.json 每题组记 `promptVersion {brief, render}`；score 端发现混版本→报错或分组警告（守 I8）。
- CLI transport：provider 配置 `transport: "cli"` + 命令模板；**prompt 走 stdin 传**（brief 数千字中文，Windows 命令行参数长度/转义/编码都是坑，禁止拼进 argv）；**system+user 合并契约显式化**（统一 `system\n\n---\n\nuser` 或用 CLI 的 system-prompt flag，所有 CLI 模型同一规则，保证与 HTTP 模型输入等价、byModel 可比）；并发固定 1；**claude 通道用 `--output-format json` 拿真实 usage**（codex 无则标"估算"）。插入现有 retry seam。
- 限流：per-provider `{concurrency, minIntervalMs}` 信号量（简单实现即可，别引重库）。
- token 预算 `evals/generator/budget.ts`：`generate --estimate` 干跑 = 按 brief 字数 + targetChars 折算（初始系数中文 ≈ chars/1.5）× 待生成篇数，分模型汇总打印；真跑后实报 = usage 累计；**自校准：每轮真跑后记录 estimate vs actual 比率，下轮估算用实测比率修正系数**。先只报 token 数，换算钱后置。
- `generate.ts`/`score.ts` 换 **commander**（子命令/flag 帮助一致化；保持现有 flag 语义兼容）。

### M3 外部检测器
- `evals/detector/`：`DetectorClient` 接口 `{name, version, detect(text) → {chunks, docAggregates}}`；首个实现 = HF `predict_zh`（协议见资源清单，冷启动重试+退避，限速）；配置可换（用户硬需求）。`version` 用 space revision/固定日期标（space 不自报版本）。
- **分块策略（截断已证实，必须自己切）**：
  - 边界 smoke：二分 `R[:500/1000/1500/2000]` vs 全文，钉死实际窗口 → 配置 `chunkChars`（初值 450）。
  - 切块：**句界对齐**（。！？…"累积，不切断句子），尾块 <150 字并入前块；eval 批量**不重叠**（未来 web 热力图可选 50% 重叠）。
  - 归一化：`P(AI) = 标签==AI ? prob : 1−prob`。
  - **sidecar 存每块原始结果** `{span, label, prob, pAi}`（原始存、聚合派生——D3 哲学，改聚合不重调 API）。
  - 文档级聚合双轨：**主 = 长度加权 mean(P(AI))**（语料整篇同源，mean 降方差，AUC 用它）；**副 = max 与 p75 同存**（未来 web 混合来源场景敏感指标）。热力图 = 每块 pAi。
- 批量打分 CLI（`detect.ts`，路径守 I10）：对 corpus 全样本打分 → **sidecar 缓存** `evals/report/detector-scores.json`（key = **样本内容 hash** + detector + version + chunkChars；存在跳过——贵结果落盘复用，同 render 哲学）。
- report 加**外部对照节**：按 role/model 的检测概率中位、外部检测器在同语料上的 AUC ↔ llmlint AUC 并排（外部效度 + 上限参照；⚠ 已知域偏移，见资源清单）；web report 页兼容展示（可后置到最小：json 里有数即可）。
- ⚠ detector 分数是**对照仪表**，不改变 docScore/lift 的任何计算（别混口径）。

### M4 小验证轮
- 2–3 新题组 × 4–6 模型（现有 3 + bailian qwen + ≥1 个 CLI 模型验 transport）全链路：estimate → generate（断点续跑演练：中断重跑跳过已完成）→ score → detect → report。
- **holdout 首次解锁**：现有 2 题组 + 新 2–3 = 4–5 ≥ `HOLDOUT_MIN_GROUPS(4)`，跑一次 `--holdout` 冒烟（还 M3-B 的账；题组仍少，train/test AUC 只作趋势看）。
- ⚠ **modelRanking 混面板 caveat**：新面板只 render 新题组，旧题组是旧 3 模型 → 全 corpus 模型排名把"模型差异"和"题材差异"混在一起；报告按题组/题材分层看排名，walkthrough 明写此 caveat。
- 更新本 walkthrough（实际结果 vs 计划出入）+ PROJECT-STATUS + METHODOLOGY §8 基线快照（若指标变化）。

## 验收

1. `bun test` 过（budget/限流/transport/分块聚合的纯函数部分按需加测，勿过度测试）。
2. 小轮 `report.json`：新题组进 lift、detector 对照节有数、≥1 个 CLI 模型 render 成功。
3. 断点续跑实测：kill 后重跑，已完成 brief/render/detector 分全部跳过。
4. 密钥合规：`.agent/llm_api.txt` 的 key 未出现在任何进 git 的文件里；`eval.config.json` 已 gitignore，`eval.config.example.json` 无密钥。
5. CLI 模型的 render 输入与 HTTP 模型等价（同 prompt 版本 + 同合并契约），byModel 可比。

## 风险 / 开放项

- ~~HF Space API 形状未验证~~ **已实测通过**（协议/端点/截断/域偏移见资源清单）。残余：窗口确切边界待 M3 二分钉死；免费实例限流/波动；**域偏移**（网文域上该检测器噪声不小，对照结论要带此前提）。
- mobi→epub 转换质量参差 → clean 阶段人工抽查；calibre 处理中文书名路径注意 spawn 编码。
- `codex exec` 在本机是否可用未验证（M2 先 `--check` 单模型 smoke）。
- doubao render 长度不稳（同模型偶发大幅欠长）已知，byModel 分层会显形，不修。

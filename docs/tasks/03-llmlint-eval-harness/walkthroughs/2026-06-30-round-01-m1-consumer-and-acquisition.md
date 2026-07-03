# Round 01 — M1 消费侧 consumer + Acquisition（2026-06-30）

> 计划：Task 03 README 的 Implementation Walkthrough（已审批）。本轮交付 M1（消费侧打分仪器）+ acquisition（整本小说 → reference）。当时评测语料按本地私有资产处理；当前 git 边界见 [Task 04](../../04-llmlint-standalone-repo/README.md)。

## 做了什么

### 生成侧 acquisition（`evals/acquire/`）
- `txt.ts`：编码探测（UTF-8 strict 失败回退 **gb18030**）+ 按 `第X章/回/节` 切章（卷标题丢弃、长度上限挡误判）。
- `epub.ts`：`fflate.unzipSync` 解 epub → OPF/spine → xhtml 去标签取纯文本（参照已有 tomato-novel 导入脚本，最小化）。
- `clean.ts`：去站点/付费/作者噪声行 + 归一空白；**刻意不动标点字形**（破折号/全角符号是规则要测的对象，动了污染评测）；`segmentChapter` 把超长章按段落切到 ~2-4k 字。
- `acquire.ts`：CLI，按后缀分流 epub/txt → reference-NNNN.md + meta.json（`role:reference, referenceSource:book-segment`，merge 时保留未来 render/repair）。

### 消费侧 consumer（`evals/`）
- `lib/scan.ts`：**直接 import `skill/src/rules` + `skill/src/scanner`**，构造默认 `NormalizedLlmlintConfig`，`loadRules` 一次、`scanText` 每样本；产原始命中 + 去重 span（码点区间合并）+ agent 桶命中。
- `lib/corpus.ts`：递归读 `<genre>/<plot>/meta.json` + 文件；稳健降级；charCount 自算（去空白码点）。
- `lib/metrics.ts`：fireRate 千字归一；`lift=(AI中位+α)/(人类中位+α)`（α=0.5）；分模型 lift；题组配对 %AI高；四桶 + min-support 守门；docScore=全规则命中/千字 → ROC-AUC（平均秩，自实现）；模型榜=docScore 中位。
- `lib/report.ts` + `score.ts`：report.json + report.md（有 AI→lift 体检表；无 AI→人类侧命中率/误杀基线）。
- `fixtures/corpus/`：2 题组（reference + 2 条塞满 tell 的假 render），验证数学。

## 验证结果

- **GBK smoke**：`TextDecoder("gb18030")` 输出「你好，世界」→ Bun 原生支持，**零依赖**（不装 iconv）。
- **acquisition 真实种子**：
  - 诡秘之主精校全本.txt（GBK，9.5MB）→ 5 单元、2425–3818 字、reference-0001 解码无乱码（第一章 绯红）。
  - 转生反派萝莉魔法少女.epub → 5 单元、2024–3396 字、epub 元数据解析（作者 十万水星）。
- **consumer fixture**（自检）：ROC-AUC **1.000**；人类 docScore 中位 45.62 vs AI 161.96；强判别 15 条。塞的 tell 精确命中：`dash-alone-to-comma` lift 26.95、`baguwen.sudden-moment` 20.19、`不是X而是Y`(contrastive/single-negative/unrealized) 13.98、`vocabulary.body.mouth-corner` 13.98、`transition-summary`/`filler-worth-noting`/`finger-segment` 强判别。
- **consumer 真实人类 reference**（10 单元，无 render）：人类 docScore 中位 21.26/千字；人类侧命中最高 `proliferation.mixed.extra-punctuation`（172 次 / 5.14 千字）、`modifier.*`（2+ 千字）；`dash-alone-to-comma` 人类仅 0.38/千字。reference-only 题组优雅处理。

## 关键发现（喂给 Task 02）

- **最强 AI 判别器躺在 human 桶**：fixture 里 lift 最高的 `dash-alone-to-comma`(26.95)、`modifier.*`(27) 都 `review:human`，默认 `check` 对 Agent 不可见。对照真实人类基线：破折号人类 0.38/千字 vs fixture AI ~13 → 破折号是强判别器实锤。这正是 Task 02 该据以调 review 路由的量化证据（与早期手测 4-tell 分析一致）。
- `proliferation.mixed.extra-punctuation` 在干净人类网文上狂命中（5.14/千字）→ 误杀第一嫌疑；是噪声还是判别器，待 AI render 配对后由 lift 定。

## 计划出入

- 计划留了"epub 复用 tomato 导入脚本 shell-out vs 自包含"，实测选**自包含最小实现**（fflate + ~50 行），因主力种子诡秘之主是 txt/GBK，tomato 工具本就不处理，统一自实现更干净、且 eval 不耦合 CLI。
- 未跑全仓 `typecheck`：当时评测工具按本地私有资产处理、未入 CI；bun 直接运行通过 + fixture 即回归保障（不过度测试）。

## Follow-ups

- M2：brief 抽取（固定 prompt，只记剧情）+ eval-writer（单次 LLM completion，需模型 API）→ 首条真实 lift。
- 出真实 lift 后，把规则体检表交给 Task 02。

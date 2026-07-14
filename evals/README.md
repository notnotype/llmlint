# llmlint 评测 harness

> 消费侧打分仪器 + 生成侧造数据管线。**方法论、流程、术语、不变量都是一等规范，不在本文维护：**
>
> - 方法论 / 流程规范（**代码按它实现**）：[METHODOLOGY.md](METHODOLOGY.md)
> - 术语与硬不变量：[../CONTEXT.md](../CONTEXT.md)
> - 现状 / 每轮变更：[../PROJECT-STATUS.md](../PROJECT-STATUS.md) · [编年 walkthrough](../docs/tasks/03-llmlint-eval-harness/README.md)
>
> 本文只讲**怎么跑**。

## 用法

```bash
# 1) 获取：整本小说 → reference 单元（txt 自动 GBK 解码；epub 用 fflate）。默认 --out=evals/corpus
bun evals/acquire/acquire.ts <book.epub|book.txt> \
    --genre <题材> --plot <剧情id> [--out <corpusRoot>] \
    [--max-chapters N] [--skip N] [--min-chars N] [--pub-year YYYY]

# 2) 生成：reference → brief → render（调模型 API；从仓库根跑或显式传 --config）。默认 --corpus=evals/corpus
bun evals/generator/generate.ts \
    [--corpus <dir>] [--models k1,k2,k3] [--extractor k] [--config workspace/.nbook/config.json] [--check]
bun evals/generator/generate.ts --list-models <provider>   # 列 provider 当前可用 model id（config 会过时）
#   注意：改了 reference 后想重抽，删对应题组的 brief-<idx>.md / render-*.md 才会重跑（缓存只看文件存在性）。

# 3) 打分：语料 → report.json。默认 --corpus=evals/corpus --out=evals/report
bun evals/score.ts [--min-support N] [--holdout <ratio>]

# 自检：fixture 验证数学（应得 AUC≈1.0）+ metrics 单测守门
bun evals/score.ts --corpus evals/fixtures/corpus --out .agent/evals/fixture-report --min-support 1
bun test evals/lib/metrics.test.ts
```

## 产物

- **`report.json`**：唯一产物，数据契约（`Report` 类型见 `lib/types.ts`）。表现层是独立关注点，交给 `web/` 报告页渲染，本 harness 不产 md/html。

## 语料契约（速览）

```
<corpus>/<genre>/<plot-id>/
  reference-NNNN.md   render-<idx>-<slug>.md   brief-<idx>.md   meta.json
```

`role:reference` = 人类类，`role:render` = AI 类，`repair` 单独统计。字段全集与语义见 [METHODOLOGY.md §6](METHODOLOGY.md#6-数据--meta-契约consumer--generator-唯一接口)。

每个 render sample 必须带 `promptVersion`，且一张报告中的版本必须唯一；缺失或混用时 `score.ts` 会直接失败。`--holdout` 只统计至少存在一条有效 `pairRef → reference.file` 映射的题组，reference-only 题组不计入 4 组门槛。

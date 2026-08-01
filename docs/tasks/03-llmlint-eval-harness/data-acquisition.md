# 数据获取工程 / Data Acquisition

> Task 03 子文档。记录评测语料里 **reference(人类基准正文)** 怎么进入流水线。生成侧(extract→render)与消费侧见 [README](./README.md)。术语见 README 的 Glossary。

## 核心原则:人工是质量闸门,不可自动化

数据量极大(番茄等平台海量),但**"哪些是优秀且典型的人类正文"需要人力手动选**。自动化只负责**体力活**(下载、解码、清洗、切章);**质量判断(选谁当 reference)是人**。

这条直接决定评测上限:**reference 纯度 = AI 检测器天花板**。垃圾 / AI 辅助 / 机翻的人类样本混进来 → 人类类被污染 → lift 失真。所以人工精选不是可选项,是闸门。

## 两种 reference 输入格式

| 格式 | 来源 | 处理 | 质量 |
|---|---|---|---|
| **① 全书** | epub / txt 整本 | 需 **切分章节** → reference 单元 | 取决于书,需清洗 + 过滤 |
| **② 人工精选片段** | 人手挑的高质量正文段 | **直接作 reference**,无需切分 | 高(已人工背书),**流水线的优质入口** |

两种最终都产出 `reference.md`;消费侧不关心来源,但 meta 记 `referenceSource: book-segment | hand-picked` 供分析。

## 快速启动种子(2026-06-30,用户手动提供)

| 文件 | 体裁 | 格式 | 备注 |
|---|---|---|---|
| 《诡秘之主》精校全本.txt(9.5MB,**GBK**) | 玄幻 / 西幻 / 克苏鲁 | ① 全书 txt | 爱潜水的乌贼,白金作者,顶级人类范本,pre-2018 |
| 转生反派萝莉,找茬魔法少女.epub(3MB) | 轻小说 / 二次元 / 魔法少女 | ① 全书 epub | |
| 退役八年,复出世界级魔法少女.epub(727KB) | 轻小说 / 魔法少女 | ① 全书 epub | |

## acquire + curate ETL

```
① 全书:  download → decode(GBK/GB18030→UTF-8) / unzip(epub) → split(第X章) → clean → tag → filter → reference 单元
② 精选:  人工挑段 → clean(轻) → tag → reference 单元
```

- **decode**:网文 txt 常见 **GBK/GB18030**(诡秘之主就是),必须先探测编码转 UTF-8,否则乱码;epub 解 zip 取 XHTML(多为 UTF-8)。
- **split**:按章节头 `第[0-9一二三四五六七八九十百千]+章` 切;丢弃 内容简介 / 前言 / 作者的话 / 卷标题。
- **clean**:去 付费墙分隔、"本章未完 / 请假条"、广告、站点水印、章末推书;归一全半角标点与空白。
- **segment 粒度**:~2-4k 字 / 单元(对齐评测粒度);单章过长可再按场景切。
- **tag**:题材 / 匿名作者 id / 来源 / 出版年 / 视角(1st/3rd) / 对话或描写型 / 质量档 / referenceSource。
- **filter**:pre-2023 偏置;近重去重;剔 AI / 机翻嫌疑。

## 来源策略(回顾 README)

- 主力:中文网文 6-8 题材(番茄为主,经 Tomato-Novel-Downloader 取);
- 高端锚:传统 / 严肃文学(genre=`literary`),小量,防误杀文学手法;
- 工具 **Tomato-Novel-Downloader**:Rust 预编译 exe,番茄小说,输出 TXT/EPUB,CLI 仅 `--update <book_id>`,新书需 TUI 交互 → acquire **半自动**。
- 合规（2026-07-27 更新）：`evals/corpus/` **不进 git**，已由 `.gitignore` 拦住。仓库自 2026-07 起公开，而这条红线此前被突破过——受版权的 reference 章节全文随仓公开过一段时间，已用 `git filter-repo --path evals/corpus --invert-paths` 从主仓全历史移除并 force push（Task 24 Phase 0）。语料只在本地保留供 evals 使用。低并发别压服务器；法律风险归用户。
  - **残留暴露（未闭合）**：两个 public fork（`Eacgh/llmlint`、`Otirik-handi/llmlint`）与主仓的 `refs/pull/1|2/head` 仍带完整语料，force push 触及不到它们。处置需要仓外动作（联系 fork 所有者 / GitHub support），见 Task 24 walkthrough。

## 代码位置

acquire + curate 属**生成侧**。稳定位置在 `evals/`（`evals/acquire/` 脚本、`evals/corpus/` 语料、`evals/report/` 报告）。脚本进 git；`evals/corpus/` 与 `evals/report/` 已 gitignore，只在本地存在（语料因版权、报告因每跑必变）。

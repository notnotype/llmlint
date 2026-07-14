# AGPL-3.0-only 许可证迁移

## Relative documents refs

- `../../../LICENSE`
- `../../../package.json`
- `../../../skill/LICENSE`
- `../../../skill/package.json`
- sibling NeuroBook `docs/tasks/103-agpl-license-migration/README.md`

## User Request / Topic

- llmlint 与 NeuroBook 一并从 PolyForm Noncommercial 1.0.0 改为 AGPLv3。
- 开发仓根和可安装 `skill/` package 必须使用同一许可证与对外口径。

## Goal

- 根开发仓与 `skill/` 真相源统一采用 GNU AGPLv3 only，并通过 NeuroBook 既有同步链生成 vendored runtime 副本。

## Current State

- 根 `LICENSE`、`skill/LICENSE`、两个 package manifest 和 skill 中英文 README 均声明 PolyForm Noncommercial 1.0.0。

## Decisions / Discussion

- SPDX 固定为 `AGPL-3.0-only`。
- 允许商业使用；分发修改版或以修改版向网络用户提供服务时，依 AGPLv3 提供对应源代码。
- `evals/` 仍是开发资产，不进入可安装 `skill/` 或 NeuroBook runtime snapshot；语料合规边界不因软件许可证迁移而改变。

## Verification / Test

- 根与 `skill/` package manifest 均解析为 `AGPL-3.0-only`。
- 根 `LICENSE` 与 `skill/LICENSE` 内容一致，均为 GNU 官方 AGPLv3 661 行原文。
- `bun run sync:neuro-book` 成功；NeuroBook 侧 vendored 和真实 user runtime 的许可证文件、README 与 package manifest 已刷新。
- NeuroBook 聚焦资产同步测试通过：1 passed，83 skipped。

## Implementation Walkthrough

- 已替换根与 `skill/` 的许可证原文、manifest 和中英文 README 许可说明。
- 同步时发现 `skill/` 存在用户原有未提交功能改动；sibling 工作区保持不变，NeuroBook tracked snapshot 只纳入许可证相关文件，避免本任务夹带其他功能变更。

## TODO / Follow-ups

- 无。

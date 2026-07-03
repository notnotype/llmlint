// 评测报告契约：复用 evals 侧 Report 系类型（via nuxt.config alias `evals`→../evals/lib）。
// 纯 import type，构建期擦除；报告页/组件都从这里拿类型，避免前端重复定义。
export type {Report, RuleStat, DetectorStat, HoldoutStat, ModelRank, StratRate} from "evals/types";

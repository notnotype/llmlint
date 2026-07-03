// 数据集契约：复用 evals 侧 Dataset/DatasetSample（via nuxt alias `evals`→../evals/lib）。纯 import type、构建期擦除。
export type {Dataset, DatasetSample} from "evals/types";

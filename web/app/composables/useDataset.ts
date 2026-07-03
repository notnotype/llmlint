import {computed, ref} from "vue";
import type {Dataset, DatasetSample} from "../dataset-types";

// 数据集查看器逻辑：加载拖入的 dataset.json + 把样本按 题材/题组/章 组织成树。
// 高亮/过滤由 dataset.vue 复用 useLlmlint 现算（浏览器本地，不发网络）。照 useReport 的 loadFile 风格。

/** 一章：本章 reference（人类）+ 挂它的各模型 render（按 pairRef 配对）。 */
export type Chapter = {key: string; reference: DatasetSample | null; renders: DatasetSample[]};
/** 一个题组（genre/plotId）下的所有章。 */
export type PlotGroup = {genre: string; plotId: string; chapters: Chapter[]};

export function useDataset() {
    /** 当前数据集；null=还没拖入。 */
    const dataset = ref<Dataset | null>(null);
    /** 上次加载错误文案；空串=无错。 */
    const error = ref<string>("");

    /** 读一个 File（dataset.json）→ 解析校验 → 置 dataset；失败写 error、清 dataset。 */
    async function loadFile(file: File): Promise<void> {
        error.value = "";
        try {
            const parsed = JSON.parse(await file.text()) as Dataset;
            if (!parsed || !Array.isArray(parsed.samples)) {
                throw new Error("不是有效的 dataset.json（缺 samples；由 bun evals/dataset.ts 生成）");
            }
            dataset.value = parsed;
        } catch (caught) {
            error.value = caught instanceof Error ? caught.message : String(caught);
            dataset.value = null;
        }
    }

    /** 样本 → 题组树：genre/plotId 分组，章 = reference 文件，render 按 pairRef 挂到本章。 */
    const groups = computed<PlotGroup[]>(() => {
        const samples = dataset.value?.samples ?? [];
        const byPlot = new Map<string, DatasetSample[]>();
        for (const sample of samples) {
            const key = `${sample.genre}/${sample.plotId}`;
            const bucket = byPlot.get(key) ?? [];
            bucket.push(sample);
            byPlot.set(key, bucket);
        }
        const out: PlotGroup[] = [];
        for (const list of byPlot.values()) {
            const references = list.filter((sample) => sample.role === "reference");
            const renders = list.filter((sample) => sample.role === "render");
            const chapters: Chapter[] = [...references]
                .sort((left, right) => left.file.localeCompare(right.file))
                .map((reference) => ({
                    key: reference.file,
                    reference,
                    renders: renders
                        .filter((render) => render.pairRef === reference.file)
                        .sort((left, right) => (left.model ?? "").localeCompare(right.model ?? "")),
                }));
            out.push({genre: list[0]!.genre, plotId: list[0]!.plotId, chapters});
        }
        return out.sort((left, right) => `${left.genre}/${left.plotId}`.localeCompare(`${right.genre}/${right.plotId}`));
    });

    return {dataset, error, loadFile, groups};
}

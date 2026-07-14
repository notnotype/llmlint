<script setup lang="ts">
import {computed, reactive, ref} from "vue";
import {useDataset, type Chapter} from "../composables/useDataset";
import {useLlmlint} from "../composables/useLlmlint";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import type {DatasetSample} from "../dataset-types";
import type {UiFilters} from "../types";

// 数据集查看器：拖入 dataset.json → 左树选章 → 参考↔演绎并排 / 单篇浏览，正文带 llmlint 高亮。
// 纯浏览器、不上传；本地专用（含版权正文）。
const {dataset, error, loadFile, groups} = useDataset();
const {scan, applyFilters, issueRanges, groupByRule, namespaceOptions} = useLlmlint();
const {t} = useLlmlintI18n();

// scanAll:true —— corpus 是纯正文（非 markdown），全文扫不遮罩，与 evals scan.ts 一致。
const filters = reactive<UiFilters>({review: "all", minLevel: "low", namespaces: [], scanAll: true});
const nsOptions = namespaceOptions();

const mode = ref<"compare" | "browse">("compare");
const selectedChapter = ref<Chapter | null>(null);
const selectedGroupKey = ref<string>("");
const compareModel = ref<string>("");
const browseSample = ref<DatasetSample | null>(null);

function pickChapter(genre: string, plotId: string, chapter: Chapter) {
    selectedChapter.value = chapter;
    selectedGroupKey.value = `${genre}/${plotId}`;
    compareModel.value = chapter.renders[0]?.model ?? "";
    browseSample.value = chapter.reference ?? chapter.renders[0] ?? null;
}

// 对比右侧的 render（按选中 model）。
const compareRender = computed<DatasetSample | null>(
    () => selectedChapter.value?.renders.find((render) => render.model === compareModel.value) ?? selectedChapter.value?.renders[0] ?? null,
);
// 本章全部样本（浏览模式的切换项）。
const chapterSamples = computed<DatasetSample[]>(() => {
    const chapter = selectedChapter.value;
    if (!chapter) {
        return [];
    }
    return [chapter.reference, ...chapter.renders].filter((sample): sample is DatasetSample => sample !== null);
});

// 分析一篇：scan → 过滤 → {ranges 高亮, groups 命中卡, count}。依赖 filters（响应式），随过滤实时重算。
function analyze(sample: DatasetSample | null): {ranges: ReturnType<typeof issueRanges>; groups: ReturnType<typeof groupByRule>; count: number} {
    if (!sample) {
        return {ranges: [], groups: [], count: 0};
    }
    const issues = applyFilters(scan(sample.text, filters.scanAll), filters);
    return {ranges: issueRanges(sample.text, issues), groups: groupByRule(issues), count: issues.length};
}
const refAnalysis = computed(() => analyze(selectedChapter.value?.reference ?? null));
const renderAnalysis = computed(() => analyze(compareRender.value));
const browseAnalysis = computed(() => analyze(browseSample.value));

function updateFilters(next: UiFilters) {
    Object.assign(filters, next);
}
function chapterLabel(key: string): string {
    return key.match(/(\d+)/u)?.[1] ?? key;
}
function sampleLabel(sample: DatasetSample): string {
    return sample.role === "reference" ? t("dataset.referenceHuman") : `render · ${sample.model ?? "?"}`;
}
</script>

<template>
    <div class="flex min-h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <!-- 未加载：拖放区 -->
        <main v-if="!dataset" class="mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(28rem,1.1fr)] lg:px-8 lg:py-10">
            <section class="min-w-0">
                <div class="mb-5 border-l-4 border-[var(--accent-signal)] pl-4">
                    <div class="font-mono text-[10px] font-black text-[var(--accent-text)]">DATASET / D-01</div>
                    <h1 class="mt-2 text-2xl font-black text-[var(--text-main)]">{{ t("header.dataset") }}</h1>
                </div>
                <DatasetDrop :error="error" @file="loadFile" />
            </section>
            <WorkspacePreview kind="dataset" />
        </main>
        <!-- 已加载：左树 + 右内容 -->
        <main v-else class="flex min-h-0 flex-1">
            <!-- 左：题组/章 树 -->
            <aside class="w-60 shrink-0 overflow-y-auto border-r border-[var(--border-color)] p-2 text-sm">
                <button class="mb-2 w-full rounded-md border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[var(--bg-hover)]" @click="dataset = null">{{ t("dataset.replace") }}</button>
                <div v-for="group in groups" :key="`${group.genre}/${group.plotId}`" class="mb-3">
                    <div class="px-1 py-1 font-mono text-xs text-[var(--text-muted)]">{{ group.genre }}/{{ group.plotId }}</div>
                    <button
                        v-for="chapter in group.chapters"
                        :key="chapter.key"
                        class="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
                        :class="selectedChapter?.key === chapter.key && selectedGroupKey === `${group.genre}/${group.plotId}` ? 'bg-[var(--bg-hover)] font-semibold' : ''"
                        @click="pickChapter(group.genre, group.plotId, chapter)"
                    >
                        <span>{{ t("dataset.chapterLabel", {chapter: chapterLabel(chapter.key)}) }}</span>
                        <span class="text-xs text-[var(--text-muted)]">{{ chapter.renders.length }} render</span>
                    </button>
                </div>
            </aside>

            <!-- 右：工具条 + 面板 -->
            <section class="flex min-h-0 flex-1 flex-col">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border-color)] px-2 py-2">
                    <!-- 模式切换 -->
                    <div class="flex gap-1">
                        <button class="rounded-md px-2 py-1 text-sm" :class="mode === 'compare' ? 'bg-[var(--accent-main)] text-white' : 'hover:bg-[var(--bg-hover)]'" @click="mode = 'compare'">{{ t("dataset.compareMode") }}</button>
                        <button class="rounded-md px-2 py-1 text-sm" :class="mode === 'browse' ? 'bg-[var(--accent-main)] text-white' : 'hover:bg-[var(--bg-hover)]'" @click="mode = 'browse'">{{ t("dataset.browseMode") }}</button>
                    </div>
                    <FilterControls :filters="filters" :namespace-options="nsOptions" @update:filters="updateFilters" />
                </div>

                <!-- 没选章 -->
                <div v-if="!selectedChapter" class="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">{{ t("dataset.selectChapterPrompt") }}</div>

                <!-- 并排对比：reference | render -->
                <div v-else-if="mode === 'compare'" class="grid min-h-0 flex-1 grid-cols-2">
                    <!-- 左：参考(人类) -->
                    <div class="flex min-h-0 flex-col border-r border-[var(--border-color)]">
                        <div class="flex items-center justify-between border-b border-[var(--border-color)] px-3 py-1.5 text-xs">
                            <span class="font-semibold">{{ t("dataset.refHumanCharCount", {count: selectedChapter.reference?.charCount ?? 0}) }}</span>
                            <span class="text-[var(--text-muted)]">{{ t("dataset.issuesHit", {count: refAnalysis.count}) }}</span>
                        </div>
                        <ReadOnlyHighlightedText v-if="selectedChapter.reference" :text="selectedChapter.reference.text" :ranges="refAnalysis.ranges" class="min-h-0 flex-1" />
                    </div>
                    <!-- 右：render（模型可选） -->
                    <div class="flex min-h-0 flex-col">
                        <div class="flex items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-1.5 text-xs">
                            <select v-model="compareModel" class="max-w-[60%] truncate rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1 py-0.5 font-mono text-xs">
                                <option v-for="render in selectedChapter.renders" :key="render.file" :value="render.model">{{ render.model }}</option>
                            </select>
                            <span class="text-[var(--text-muted)]">{{ t("dataset.renderStats", {char: compareRender?.charCount ?? 0, hit: renderAnalysis.count}) }}</span>
                        </div>
                        <ReadOnlyHighlightedText v-if="compareRender" :text="compareRender.text" :ranges="renderAnalysis.ranges" class="min-h-0 flex-1" />
                        <div v-else class="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">{{ t("dataset.noRender") }}</div>
                    </div>
                </div>

                <!-- 单篇浏览：选样本 → 正文 + 命中卡 -->
                <div v-else class="grid min-h-0 flex-1 grid-cols-[1fr_20rem]">
                    <div class="flex min-h-0 flex-col border-r border-[var(--border-color)]">
                        <div class="flex flex-wrap items-center gap-1 border-b border-[var(--border-color)] px-2 py-1.5">
                            <button
                                v-for="sample in chapterSamples"
                                :key="sample.file"
                                class="rounded-md px-2 py-0.5 text-xs"
                                :class="browseSample?.file === sample.file ? 'bg-[var(--accent-main)] text-white' : 'border border-[var(--border-color)] hover:bg-[var(--bg-hover)]'"
                                @click="browseSample = sample"
                            >{{ sampleLabel(sample) }}</button>
                            <span class="ml-auto text-xs text-[var(--text-muted)]">{{ t("dataset.renderStats", {char: browseSample?.charCount ?? 0, hit: browseAnalysis.count}) }}</span>
                        </div>
                        <ReadOnlyHighlightedText v-if="browseSample" :text="browseSample.text" :ranges="browseAnalysis.ranges" class="min-h-0 flex-1" />
                    </div>
                    <!-- 命中卡列表（复用 IssueList） -->
                    <div class="min-h-0 overflow-hidden">
                        <IssueList :groups="browseAnalysis.groups" :has-text="true" />
                    </div>
                </div>
            </section>
        </main>
    </div>
</template>

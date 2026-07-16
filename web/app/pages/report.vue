<script setup lang="ts">
import {ref} from "vue";
import {useReport} from "../composables/useReport";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

// 评测报告查看器：拖入 report.json → 检测器 / holdout / 模型榜 / 规则表。纯浏览器、不上传。
const {report, error, loadFile, table, rows, sortBy, verdictCounts} = useReport();
const {t} = useLlmlintI18n();

// 「加载内置示例报告」：fetch 构建期预烘到 public 的 report.json（带 baseURL），转 File 复用 loadFile。
const config = useRuntimeConfig();
const loadingSample = ref(false);
async function loadSample() {
    loadingSample.value = true;
    try {
        const res = await fetch(`${config.app.baseURL}report.json`);
        if (!res.ok) {
            throw new Error(`加载内置示例报告失败（${res.status}）`);
        }
        await loadFile(new File([await res.blob()], "report.json", {type: "application/json"}));
    } catch (caught) {
        error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
        loadingSample.value = false;
    }
}
</script>

<template>
    <div class="flex min-h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <!-- 未加载：上传工具 + 报告结构预览，避免空态悬在整屏中央。 -->
        <main v-if="!report" class="mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.9fr)] lg:px-8 lg:py-10">
            <section class="min-w-0">
                <div class="mb-5 border-l-4 border-[var(--accent-pop)] pl-4">
                    <div class="font-mono text-[10px] font-black text-[var(--accent-text)]">REPORT / R-01</div>
                    <h1 class="mt-2 text-2xl font-black text-[var(--text-main)]">{{ t("header.report") }}</h1>
                </div>
                <ReportDrop :error="error" @file="loadFile" />
                <div class="mt-4 flex justify-center">
                    <button
                        :disabled="loadingSample"
                        class="inline-flex h-9 items-center gap-2 border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                        @click="loadSample"
                    >
                        <span class="i-lucide-file-text h-4 w-4" />
                        <span>{{ loadingSample ? t("report.loading") : t("report.loadSample") }}</span>
                    </button>
                </div>
            </section>
            <WorkspacePreview kind="report" />
        </main>

        <!-- 已加载：报告各区块 -->
        <main v-else class="mx-auto w-full max-w-7xl flex-1 p-4">
            <div class="space-y-4">
                <!-- 概览行 -->
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-muted)]">
                    <span>题组 <b class="text-[var(--text-main)]">{{ report.counts.groups }}</b></span>
                    <span>reference {{ report.counts.reference }} · render {{ report.counts.render }} · repair {{ report.counts.repair }}</span>
                    <span>活跃 regex {{ report.activeRegexRules }} · 命中 {{ report.rules.length }} · min-support {{ report.minSupport }}</span>
                    <button class="ml-auto rounded border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[var(--bg-hover)]" @click="report = null">{{ t("report.replace") }}</button>
                </div>
                <p class="text-xs text-[var(--text-muted)]">{{ report.generatedNote }}</p>

                <ReportDetectorCard :detector="report.detector" />
                <ReportHoldoutCard v-if="report.holdout" :holdout="report.holdout" />
                <ReportModelRanking v-if="report.modelRanking.length" :ranking="report.modelRanking" :human-score="report.detector.humanMedianScore" />
                <ReportRuleTable
                    :rows="rows"
                    :counts="verdictCounts"
                    :total="report.rules.length"
                    :table="table"
                    @sort="sortBy"
                    @set-verdict="table.verdict = $event"
                    @set-query="table.query = $event"
                />

                <!-- 警告 -->
                <section v-if="report.warnings.length" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                    <h2 class="mb-1 font-semibold">警告（{{ report.warnings.length }}）</h2>
                    <ul class="list-disc pl-5 text-zinc-600 dark:text-zinc-300">
                        <li v-for="(warning, index) in report.warnings.slice(0, 30)" :key="index">{{ warning }}</li>
                    </ul>
                </section>
            </div>
        </main>
    </div>
</template>

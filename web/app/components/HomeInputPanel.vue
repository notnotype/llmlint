<script setup lang="ts">
import {computed, ref, onMounted, watch, nextTick} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {SAMPLE_TEXT} from "../utils/sample-text";

import {useRecentScans, type RecentScan} from "../composables/useRecentScans";

const text = defineModel<string>({required: true});
const emit = defineEmits<{(e: "submit"): void}>();
const {locale, t} = useLlmlintI18n();

const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const fileName = ref("");
const fileError = ref(false);

const {scans, updateScores, removeScan, clearScans} = useRecentScans();

async function loadRecentScan(scan: RecentScan): Promise<void> {
    text.value = scan.text;
    fileName.value = scan.title;
    fileError.value = false;
    await nextTick();
    submit();
}

function formatTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("home.historyJustNow");
    if (mins < 60) return t("home.historyMinutesAgo", {count: mins});
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("home.historyHoursAgo", {count: hours});
    return new Date(timestamp).toLocaleDateString(locale.value, {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

const isHistoryExpanded = ref(true);
const collapsedHistoryLetters = computed(() => t("home.recentScansCollapsed").split(""));

function toggleHistory(): void {
    isHistoryExpanded.value = !isHistoryExpanded.value;
}

onMounted(() => {
    if (import.meta.client) {
        const saved = window.localStorage.getItem("llmlint.historyExpanded.v1");
        if (saved !== null) {
            isHistoryExpanded.value = saved === "true";
        }
    }
});

watch(isHistoryExpanded, (val) => {
    if (import.meta.client) {
        window.localStorage.setItem("llmlint.historyExpanded.v1", String(val));
    }
});

const canSubmit = computed(() => text.value.trim().length > 0);
const charCount = computed(() => text.value.length);

/**
 * 把本地文本文件读入输入区。
 */
async function loadFile(file: File): Promise<void> {
    fileError.value = false;
    try {
        text.value = await file.text();
        fileName.value = file.name;
    } catch {
        fileError.value = true;
    }
}

/**
 * 处理文件拖入。
 */
async function onDrop(event: DragEvent): Promise<void> {
    dragOver.value = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
        await loadFile(file);
    }
}

/**
 * 处理点击选择文件。
 */
async function onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
        await loadFile(file);
    }
    input.value = "";
}

/**
 * 载入内置示例文本。
 */
function loadSample(): void {
    text.value = SAMPLE_TEXT;
    fileName.value = "";
    fileError.value = false;
}

/**
 * 提交首页输入，进入检测工作台。
 */
function submit(): void {
    if (canSubmit.value) {
        emit("submit");
    }
}
</script>

<template>
    <section class="home-input relative flex flex-col h-full min-h-0 overflow-auto bg-[var(--bg-main)]">
        <div class="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
            <!-- 拥有 relative 锚点的主输入区容器，大屏右侧绝对定位挂载侧边栏，从而保证主输入区永远绝对居中 -->
            <div class="relative w-full">
                <!-- 主题大标题与介绍 -->
                <div class="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                    <div class="min-w-0 md:max-w-2xl">
                        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent-text)]">llmlint</p>
                        <h1 class="mt-2 text-2xl font-semibold text-[var(--text-main)] sm:text-3xl">{{ t("home.title") }}</h1>
                        <p class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{{ t("home.description") }}</p>
                    </div>
                    <div class="hidden text-right text-xs leading-6 text-[var(--text-muted)] md:block md:flex-shrink-0">
                        <div>{{ t("home.local") }}</div>
                        <div>{{ t("home.markdown") }}</div>
                    </div>
                </div>

                <!-- 首页输入工具面板 -->
                <div
                    class="overflow-hidden rounded-lg border bg-[var(--bg-panel)] shadow-sm transition-colors"
                    :class="dragOver ? 'border-[var(--accent-main)] ring-2 ring-[var(--accent-main)]/20' : 'border-[var(--border-color)]'"
                    @dragenter.prevent="dragOver = true"
                    @dragover.prevent="dragOver = true"
                    @dragleave.prevent="dragOver = false"
                    @drop.prevent="onDrop"
                >
                    <textarea
                        v-model="text"
                        class="h-[44vh] min-h-72 w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                        :placeholder="t('home.placeholder')"
                        spellcheck="false"
                        @keydown.ctrl.enter.prevent="submit"
                        @keydown.meta.enter.prevent="submit"
                    />
                    <div class="grid grid-cols-1 gap-2 border-t border-[var(--border-color)] bg-[var(--bg-subtle)] px-4 py-2.5 text-sm sm:grid-cols-3 sm:items-center">
                        <!-- 左栏：状态与字数 -->
                        <div class="min-w-0 truncate text-xs text-[var(--text-muted)] text-center sm:text-left">
                            <template v-if="fileError">{{ t("home.fileReadFailed") }}</template>
                            <template v-else-if="fileName">{{ fileName }} · {{ t("text.wordCount", {count: charCount}) }}</template>
                            <template v-else>{{ t("text.wordCount", {count: charCount}) }}</template>
                        </div>

                        <!-- 中栏：开始检测核心按钮 -->
                        <div class="flex justify-center order-first sm:order-none">
                            <button
                                type="button"
                                class="inline-flex h-9 w-full sm:w-auto items-center justify-center gap-1.5 rounded-md bg-[var(--accent-main)] px-6 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:brightness-105 shadow-sm"
                                :disabled="!canSubmit"
                                @click="submit"
                            >
                                <span class="i-lucide-scan-text h-4 w-4" />
                                <span>{{ t("home.start") }}</span>
                            </button>
                        </div>

                        <!-- 右栏：操作按钮组 -->
                        <div class="flex justify-center sm:justify-end gap-2">
                            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="fileInput?.click()">
                                <span class="i-lucide-upload h-3.5 w-3.5" />
                                <span>{{ t("home.pickFile") }}</span>
                            </button>
                            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="loadSample">
                                <span class="i-lucide-file-text h-3.5 w-3.5" />
                                <span>{{ t("text.sample") }}</span>
                            </button>
                        </div>
                        <input ref="fileInput" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" class="hidden" @change="onPick" >
                    </div>
                </div>
            </div>
        </div>
 
        <!-- 最近检测历史记录板块（大屏下绝对定位挂载在视口最右侧） -->
        <div
            v-if="scans.length > 0"
            class="mx-auto w-full max-w-3xl shrink-0 transition-all duration-300 px-4 pb-8 xl:pb-0 xl:px-0 xl:max-w-none mt-4 xl:mt-0 xl:absolute xl:right-8 xl:top-[140px] xl:z-10"
            :class="[
                isHistoryExpanded ? 'xl:w-[280px]' : 'xl:w-12'
            ]"
        >
            <!-- 大屏专用的卡片侧边栏（包含展开态和收缩态的平滑过渡，大屏下显示） -->
            <div class="hidden xl:block w-full h-full relative">
                <!-- 大屏展开态 -->
                <div
                    class="w-[280px] shrink-0 transition-all duration-300 flex flex-col h-full"
                    :class="[
                        isHistoryExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-y-0 left-0'
                    ]"
                >
                    <div class="mb-4 flex items-center justify-between">
                        <h3 class="flex items-center gap-1.5 text-sm font-medium text-[var(--text-main)]">
                            <span class="i-lucide-history h-4 w-4 text-[var(--text-muted)]" />
                            <span>{{ t("home.recentScans") }}</span>
                        </h3>
                        <div class="flex items-center gap-1.5">
                            <button
                                type="button"
                                class="text-[var(--text-muted)] hover:text-red-500 transition-colors p-1 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                                :title="t('home.clearHistoryTitle')"
                                @click="clearScans"
                            >
                                <span class="i-lucide-trash-2 h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                class="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded hover:bg-[var(--bg-hover)]"
                                :title="t('home.collapseHistoryTitle')"
                                @click="toggleHistory"
                            >
                                <span class="i-lucide-chevron-right h-4 w-4" />
                            </button>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 gap-4 xl:max-h-[68vh] xl:overflow-y-auto pr-1">
                        <div
                            v-for="scan in scans"
                            :key="scan.id"
                            class="group relative flex flex-col justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 transition hover:border-[var(--accent-main)]/50 hover:shadow-sm"
                        >
                            <div class="cursor-pointer flex-1 pr-6" @click="loadRecentScan(scan)">
                                <p class="line-clamp-2 text-sm leading-relaxed text-[var(--text-main)] font-medium mb-2">
                                    {{ scan.title }}
                                </p>
                                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)] mb-3">
                                    <span>{{ t("text.wordCount", {count: scan.charCount}) }}</span>
                                    <span>·</span>
                                    <span class="text-amber-600 dark:text-amber-400 font-semibold">{{ t("home.historyIssueCount", {count: scan.issueCount}) }}</span>
                                    <span>·</span>
                                    <span>{{ formatTime(scan.timestamp) }}</span>
                                </div>
                            </div>
                            
                            <button
                                type="button"
                                class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-500 transition-opacity p-1"
                                :title="t('home.deleteHistoryTitle')"
                                @click="removeScan(scan.id)"
                            >
                                <span class="i-lucide-x h-3.5 w-3.5" />
                            </button>

                            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)]/60 pt-3 mt-2 text-[11px]">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-[var(--text-muted)]">{{ t("home.aiFlavor") }}:</span>
                                    <div class="flex items-center">
                                        <button
                                            v-for="score in 5"
                                            :key="score"
                                            type="button"
                                            class="p-0.5 transition-transform hover:scale-125"
                                            @click="updateScores(scan.id, { aiFlavor: scan.scores.aiFlavor === score ? null : score })"
                                        >
                                            <span
                                                class="i-lucide-flame block h-3.5 w-3.5"
                                                :class="scan.scores.aiFlavor && scan.scores.aiFlavor >= score ? 'text-amber-500 fill-amber-500' : 'text-zinc-300 dark:text-zinc-700'"
                                            />
                                        </button>
                                    </div>
                                </div>

                                <div class="flex items-center gap-1.5">
                                    <span class="text-[var(--text-muted)]">{{ t("home.readability") }}:</span>
                                    <div class="flex items-center">
                                        <button
                                            v-for="score in 5"
                                            :key="score"
                                            type="button"
                                            class="p-0.5 transition-transform hover:scale-125"
                                            @click="updateScores(scan.id, { wantReadOn: scan.scores.wantReadOn === score ? null : score })"
                                        >
                                            <span
                                                class="i-lucide-heart block h-3.5 w-3.5"
                                                :class="scan.scores.wantReadOn && scan.scores.wantReadOn >= score ? 'text-rose-500 fill-rose-500' : 'text-zinc-300 dark:text-zinc-700'"
                                            />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- 大屏收起态（竖条，大屏下显示） -->
                <div
                    class="w-12 shrink-0 transition-all duration-300 flex flex-col items-center py-6 border border-[var(--border-color)] bg-[var(--bg-panel)] rounded-lg hover:border-[var(--accent-main)]/40 hover:bg-[var(--bg-hover)] cursor-pointer select-none shadow-sm"
                    :class="[
                        !isHistoryExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-y-0 left-0'
                    ]"
                    :title="t('home.expandHistoryTitle')"
                    @click="toggleHistory"
                >
                    <span class="i-lucide-chevron-left h-4 w-4 text-[var(--text-muted)] mb-4" />
                    <span class="i-lucide-history h-4 w-4 text-[var(--accent-text)] mb-3" />
                    <div class="flex flex-col items-center gap-1 text-[var(--text-muted)] text-[11px] font-medium tracking-widest leading-none">
                        <span v-for="(letter, index) in collapsedHistoryLetters" :key="`${letter}-${index}`">{{ letter }}</span>
                    </div>
                </div>
            </div>

            <!-- 小屏（xl 以下）专用的卡片历史记录（流式排布，支持折叠，小屏下显示） -->
            <div class="xl:hidden w-full">
                <!-- 小屏展开态 -->
                <div v-if="isHistoryExpanded" class="flex flex-col mt-6">
                    <div class="mb-4 flex items-center justify-between">
                        <h3 class="flex items-center gap-1.5 text-sm font-medium text-[var(--text-main)]">
                            <span class="i-lucide-history h-4 w-4 text-[var(--text-muted)]" />
                            <span>{{ t("home.recentScans") }}</span>
                        </h3>
                        <div class="flex items-center gap-1.5">
                            <button
                                type="button"
                                class="text-[var(--text-muted)] hover:text-red-500 transition-colors p-1 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                                :title="t('home.clearHistoryTitle')"
                                @click="clearScans"
                            >
                                <span class="i-lucide-trash-2 h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                class="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded hover:bg-[var(--bg-hover)]"
                                :title="t('home.collapseHistoryTitle')"
                                @click="toggleHistory"
                            >
                                <span class="i-lucide-chevron-down h-4 w-4" />
                            </button>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div
                            v-for="scan in scans"
                            :key="scan.id"
                            class="group relative flex flex-col justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 transition hover:border-[var(--accent-main)]/50 hover:shadow-sm"
                        >
                            <div class="cursor-pointer flex-1 pr-6" @click="loadRecentScan(scan)">
                                <p class="line-clamp-2 text-sm leading-relaxed text-[var(--text-main)] font-medium mb-2">
                                    {{ scan.title }}
                                </p>
                                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)] mb-3">
                                    <span>{{ t("text.wordCount", {count: scan.charCount}) }}</span>
                                    <span>·</span>
                                    <span class="text-amber-600 dark:text-amber-400 font-semibold">{{ t("home.historyIssueCount", {count: scan.issueCount}) }}</span>
                                    <span>·</span>
                                    <span>{{ formatTime(scan.timestamp) }}</span>
                                </div>
                            </div>
                            
                            <button
                                type="button"
                                class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-500 transition-opacity p-1"
                                :title="t('home.deleteHistoryTitle')"
                                @click="removeScan(scan.id)"
                            >
                                <span class="i-lucide-x h-3.5 w-3.5" />
                            </button>

                            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)]/60 pt-3 mt-2 text-[11px]">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-[var(--text-muted)]">{{ t("home.aiFlavor") }}:</span>
                                    <div class="flex items-center">
                                        <button
                                            v-for="score in 5"
                                            :key="score"
                                            type="button"
                                            class="p-0.5 transition-transform hover:scale-125"
                                            @click="updateScores(scan.id, { aiFlavor: scan.scores.aiFlavor === score ? null : score })"
                                        >
                                            <span
                                                class="i-lucide-flame block h-3.5 w-3.5"
                                                :class="scan.scores.aiFlavor && scan.scores.aiFlavor >= score ? 'text-amber-500 fill-amber-500' : 'text-zinc-300 dark:text-zinc-700'"
                                            />
                                        </button>
                                    </div>
                                </div>

                                <div class="flex items-center gap-1.5">
                                    <span class="text-[var(--text-muted)]">{{ t("home.readability") }}:</span>
                                    <div class="flex items-center">
                                        <button
                                            v-for="score in 5"
                                            :key="score"
                                            type="button"
                                            class="p-0.5 transition-transform hover:scale-125"
                                            @click="updateScores(scan.id, { wantReadOn: scan.scores.wantReadOn === score ? null : score })"
                                        >
                                            <span
                                                class="i-lucide-heart block h-3.5 w-3.5"
                                                :class="scan.scores.wantReadOn && scan.scores.wantReadOn >= score ? 'text-rose-500 fill-rose-500' : 'text-zinc-300 dark:text-zinc-700'"
                                            />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 小屏收起态（横条） -->
                <div
                    v-else
                    class="flex items-center justify-between border border-[var(--border-color)] bg-[var(--bg-panel)] rounded-lg px-4 py-3 cursor-pointer hover:border-[var(--accent-main)]/30 hover:bg-[var(--bg-hover)] transition-colors mt-6 shadow-sm"
                    @click="toggleHistory"
                >
                    <div class="flex items-center gap-2 text-sm font-medium text-[var(--text-main)]">
                        <span class="i-lucide-history h-4 w-4 text-[var(--text-muted)]" />
                        <span>{{ t("home.recentScans") }} ({{ scans.length }})</span>
                    </div>
                    <button type="button" class="text-[var(--text-muted)] p-1 rounded hover:bg-[var(--bg-hover)]">
                        <span class="i-lucide-chevron-right h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    </section>
</template>

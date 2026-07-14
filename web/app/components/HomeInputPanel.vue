<script setup lang="ts">
import {computed, ref, onMounted, watch, nextTick} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {SAMPLE_TEXT} from "../utils/sample-text";

import {useRecentScans, type RecentScan} from "../composables/useRecentScans";

const text = defineModel<string>({required: true});
const props = defineProps<{
    activeRegexRules: number;
    llmRules: number;
}>();
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
    <section class="home-input relative flex h-full min-h-0 flex-col overflow-auto bg-[var(--bg-main)]">
        <div class="home-speed-cut pointer-events-none absolute inset-y-0 right-0" aria-hidden="true" />
        <div
            class="home-stage mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center px-4 py-7 sm:px-6 lg:px-8 xl:max-w-6xl xl:pr-[320px]"
        >
            <!-- 拥有 relative 锚点的主输入区容器，大屏右侧绝对定位挂载侧边栏，从而保证主输入区永远绝对居中 -->
            <div class="relative w-full">
                <!-- 主题大标题与介绍 -->
                <div class="home-heading mb-5 flex items-start justify-between gap-4">
                    <div class="min-w-0 max-w-2xl">
                        <div class="inline-flex items-center gap-2 text-xs font-black text-[var(--accent-text)]">
                            <span class="i-lucide-sparkles h-3.5 w-3.5 text-[var(--accent-pop)]" />
                            <span>LLMLINT / L-01</span>
                        </div>
                        <h1 class="home-title mt-2 text-2xl font-black text-[var(--text-main)] sm:text-3xl">{{ t("home.title") }}</h1>
                        <p class="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{{ t("home.description") }}</p>
                    </div>
                    <div class="home-unit-seal hidden shrink-0 items-center justify-center md:flex" aria-hidden="true">
                        <span class="i-lucide-bot h-7 w-7" />
                    </div>
                </div>

                <!-- 首页输入工具面板 -->
                <div
                    class="home-editor-frame relative overflow-hidden border bg-[var(--bg-panel)] transition-colors"
                    :class="dragOver ? 'border-[var(--accent-main)] ring-2 ring-[var(--accent-main)]/20' : 'border-[var(--border-strong)]'"
                    @dragenter.prevent="dragOver = true"
                    @dragover.prevent="dragOver = true"
                    @dragleave.prevent="dragOver = false"
                    @drop.prevent="onDrop"
                >
                    <div class="home-editor-rail flex h-7 items-center justify-between border-b border-[var(--border-color)] px-3" aria-hidden="true">
                        <div class="flex items-center gap-1.5">
                            <span class="h-2 w-6 bg-[var(--accent-pop)]" />
                            <span class="h-2 w-3 bg-[var(--accent-signal)]" />
                            <span class="h-2 w-10 bg-[var(--accent-main)]" />
                        </div>
                        <div class="flex items-center gap-1.5 text-[var(--text-muted)]">
                            <span class="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" />
                            <span class="font-mono text-[10px] font-bold">L-01</span>
                        </div>
                    </div>
                    <textarea
                        v-model="text"
                        class="home-manuscript h-[44vh] min-h-72 w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                        :placeholder="t('home.placeholder')"
                        spellcheck="false"
                        @keydown.ctrl.enter.prevent="submit"
                        @keydown.meta.enter.prevent="submit"
                    />
                    <div class="home-action-bar grid grid-cols-1 gap-2 border-t border-[var(--border-color)] bg-[var(--bg-subtle)] px-4 py-2.5 text-sm sm:grid-cols-3 sm:items-center">
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
                                class="home-primary-action inline-flex h-9 w-full items-center justify-center gap-1.5 bg-[var(--accent-main)] px-7 text-sm font-black text-white transition disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:brightness-110 sm:w-auto"
                                :disabled="!canSubmit"
                                @click="submit"
                            >
                                <span class="i-lucide-scan-text h-4 w-4" />
                                <span>{{ t("home.start") }}</span>
                            </button>
                        </div>

                        <!-- 右栏：操作按钮组 -->
                        <div class="flex justify-center sm:justify-end gap-2">
                            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded border border-[var(--border-color)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="fileInput?.click()">
                                <span class="i-lucide-upload h-3.5 w-3.5" />
                                <span>{{ t("home.pickFile") }}</span>
                            </button>
                            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded border border-[var(--border-color)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="loadSample">
                                <span class="i-lucide-file-text h-3.5 w-3.5" />
                                <span>{{ t("text.sample") }}</span>
                            </button>
                        </div>
                        <input ref="fileInput" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" class="hidden" @change="onPick" >
                    </div>
                </div>
            </div>
        </div>

        <aside v-if="scans.length === 0" class="registry-rail absolute right-8 top-[140px] hidden w-[280px] border border-[var(--border-strong)] bg-[var(--bg-panel)] p-4 xl:block">
            <header class="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
                <span class="font-mono text-[10px] font-black text-[var(--text-main)]">RULE DECK / LIVE</span>
                <span class="inline-flex items-center gap-1.5 font-mono text-[9px] text-[var(--text-muted)]">
                    <span class="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" /> READY
                </span>
            </header>
            <div class="grid grid-cols-2 gap-2 py-4">
                <div class="border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <span class="block font-mono text-[9px] text-[var(--text-muted)]">REGEX</span>
                    <b class="mt-1 block font-mono text-2xl text-[var(--accent-main)]">{{ props.activeRegexRules }}</b>
                </div>
                <div class="border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <span class="block font-mono text-[9px] text-[var(--text-muted)]">LLM</span>
                    <b class="mt-1 block font-mono text-2xl text-[var(--accent-pop)]">{{ props.llmRules }}</b>
                </div>
            </div>
            <div class="space-y-3 border-y border-[var(--border-color)] py-4" aria-hidden="true">
                <div v-for="(lane, index) in ['CONTRAST', 'FILLER', 'JARGON', 'PUNCTUATION']" :key="lane" class="grid grid-cols-[5.5rem_1fr] items-center gap-2">
                    <span class="font-mono text-[9px] text-[var(--text-muted)]">{{ lane }}</span>
                    <span class="h-1.5 bg-[var(--bg-subtle)]"><span class="block h-full" :class="index === 0 ? 'w-[86%] bg-[var(--accent-main)]' : index === 1 ? 'w-[68%] bg-[var(--accent-pop)]' : index === 2 ? 'w-[52%] bg-[var(--accent-signal)]' : 'w-[74%] bg-[var(--accent-main)]'" /></span>
                </div>
            </div>
            <footer class="mt-4 grid grid-cols-2 gap-2 font-mono text-[9px] text-[var(--text-muted)]">
                <span class="inline-flex items-center gap-1.5"><span class="i-lucide-monitor-cog h-3.5 w-3.5 text-[var(--accent-text)]" /> LOCAL</span>
                <span class="inline-flex items-center gap-1.5"><span class="i-lucide-file-text h-3.5 w-3.5 text-[var(--accent-signal)]" /> MD MASK</span>
            </footer>
        </aside>
 
        <!-- 最近检测历史记录：内容共用一份模板，仅由响应式类切换侧栏/流式布局。 -->
        <div
            v-if="scans.length > 0"
            class="mx-auto w-full max-w-3xl shrink-0 transition-all duration-300 px-4 pb-8 xl:pb-0 xl:px-0 xl:max-w-none mt-4 xl:mt-0 xl:absolute xl:right-8 xl:top-[140px] xl:z-10"
            :class="isHistoryExpanded ? 'xl:w-[280px]' : 'xl:w-12'"
        >
            <div v-if="isHistoryExpanded" class="mt-6 flex flex-col xl:mt-0 xl:h-full xl:w-[280px]">
                <div class="mb-4 flex items-center justify-between">
                    <h3 class="flex items-center gap-1.5 text-sm font-medium text-[var(--text-main)]">
                        <span class="i-lucide-history h-4 w-4 text-[var(--text-muted)]" />
                        <span>{{ t("home.recentScans") }}</span>
                    </h3>
                    <div class="flex items-center gap-1.5">
                        <button
                            type="button"
                            class="flex items-center justify-center rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-red-500"
                            :aria-label="t('home.clearHistoryTitle')"
                            :title="t('home.clearHistoryTitle')"
                            @click="clearScans"
                        >
                            <span class="i-lucide-trash-2 h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            class="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                            :aria-label="t('home.collapseHistoryTitle')"
                            :title="t('home.collapseHistoryTitle')"
                            @click="toggleHistory"
                        >
                            <span class="i-lucide-chevron-down h-4 w-4 xl:hidden" />
                            <span class="i-lucide-chevron-right hidden h-4 w-4 xl:block" />
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:max-h-[68vh] xl:grid-cols-1 xl:overflow-y-auto xl:pr-1">
                    <div
                        v-for="scan in scans"
                        :key="scan.id"
                        class="history-card group relative flex flex-col justify-between border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 transition hover:border-[var(--accent-main)]"
                    >
                        <button type="button" class="flex-1 pr-6 text-left" @click="loadRecentScan(scan)">
                            <span class="mb-2 line-clamp-2 text-sm font-medium leading-relaxed text-[var(--text-main)]">{{ scan.title }}</span>
                            <span class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                                <span>{{ t("text.wordCount", {count: scan.charCount}) }}</span>
                                <span>·</span>
                                <span class="font-semibold text-amber-600 dark:text-amber-400">{{ t("home.historyIssueCount", {count: scan.issueCount}) }}</span>
                                <span>·</span>
                                <span>{{ formatTime(scan.timestamp) }}</span>
                            </span>
                        </button>

                        <button
                            type="button"
                            class="absolute right-3 top-3 p-1 text-[var(--text-muted)] transition-colors hover:text-red-500"
                            :aria-label="t('home.deleteHistoryTitle')"
                            :title="t('home.deleteHistoryTitle')"
                            @click="removeScan(scan.id)"
                        >
                            <span class="i-lucide-x h-3.5 w-3.5" />
                        </button>

                        <div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)]/60 pt-3 text-[11px]">
                            <div class="flex items-center gap-1.5">
                                <span class="text-[var(--text-muted)]">{{ t("home.aiFlavor") }}:</span>
                                <div class="flex items-center">
                                    <button
                                        v-for="score in 5"
                                        :key="score"
                                        type="button"
                                        class="p-0.5 transition-transform hover:scale-125"
                                        :aria-pressed="scan.scores.aiFlavor === score"
                                        :title="`${t('home.aiFlavor')} ${score}/5`"
                                        @click="updateScores(scan.id, {aiFlavor: scan.scores.aiFlavor === score ? null : score})"
                                    >
                                        <span
                                            class="i-lucide-flame block h-3.5 w-3.5"
                                            :class="scan.scores.aiFlavor && scan.scores.aiFlavor >= score ? 'fill-amber-500 text-amber-500' : 'text-zinc-300 dark:text-zinc-700'"
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
                                        :aria-pressed="scan.scores.wantReadOn === score"
                                        :title="`${t('home.readability')} ${score}/5`"
                                        @click="updateScores(scan.id, {wantReadOn: scan.scores.wantReadOn === score ? null : score})"
                                    >
                                        <span
                                            class="i-lucide-heart block h-3.5 w-3.5"
                                            :class="scan.scores.wantReadOn && scan.scores.wantReadOn >= score ? 'fill-rose-500 text-rose-500' : 'text-zinc-300 dark:text-zinc-700'"
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else class="w-full">
                <button
                    type="button"
                    class="history-collapsed hidden w-12 flex-col items-center border border-[var(--border-color)] bg-[var(--bg-panel)] py-6 text-[var(--text-muted)] transition-colors hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)] xl:flex"
                    :aria-label="t('home.expandHistoryTitle')"
                    :title="t('home.expandHistoryTitle')"
                    @click="toggleHistory"
                >
                    <span class="i-lucide-chevron-left mb-4 h-4 w-4" />
                    <span class="i-lucide-history mb-3 h-4 w-4 text-[var(--accent-text)]" />
                    <span class="flex flex-col items-center gap-1 text-[11px] font-medium leading-none tracking-widest">
                        <span v-for="(letter, index) in collapsedHistoryLetters" :key="`${letter}-${index}`">{{ letter }}</span>
                    </span>
                </button>
                <button
                    type="button"
                    class="mt-6 flex w-full items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3 text-[var(--text-main)] shadow-sm transition-colors hover:border-[var(--accent-main)]/30 hover:bg-[var(--bg-hover)] xl:hidden"
                    :aria-label="t('home.expandHistoryTitle')"
                    :title="t('home.expandHistoryTitle')"
                    @click="toggleHistory"
                >
                    <span class="flex items-center gap-2 text-sm font-medium">
                        <span class="i-lucide-history h-4 w-4 text-[var(--text-muted)]" />
                        <span>{{ t("home.recentScans") }} ({{ scans.length }})</span>
                    </span>
                    <span class="i-lucide-chevron-right h-4 w-4 text-[var(--text-muted)]" />
                </button>
            </div>
        </div>
    </section>
</template>

<style scoped>
.home-input {
    isolation: isolate;
}

.home-speed-cut {
    z-index: -1;
    width: clamp(7rem, 18vw, 18rem);
    border-left: 1px solid color-mix(in srgb, var(--accent-main) 22%, transparent);
    background-image: repeating-linear-gradient(
        118deg,
        transparent 0 12px,
        color-mix(in srgb, var(--accent-main) 11%, transparent) 12px 13px,
        transparent 13px 24px,
        color-mix(in srgb, var(--accent-pop) 8%, transparent) 24px 25px
    );
    clip-path: polygon(42% 0, 100% 0, 100% 100%, 0 100%);
}

.home-stage {
    position: relative;
}

.home-stage::before,
.home-stage::after {
    position: absolute;
    z-index: -1;
    background: var(--manga-ink);
    content: "";
    opacity: 0.08;
}

.home-stage::before {
    top: 6%;
    left: 1rem;
    width: 2px;
    height: 18%;
}

.home-stage::after {
    right: 1rem;
    bottom: 7%;
    width: 18%;
    height: 2px;
}

.home-heading {
    position: relative;
    border-left: 3px solid var(--accent-pop);
    padding-left: 1rem;
}

.home-heading::after {
    position: absolute;
    bottom: -0.4rem;
    left: 1rem;
    width: 3.5rem;
    height: 3px;
    background: var(--accent-signal);
    content: "";
}

.home-title {
    line-height: 1.14;
    text-wrap: balance;
}

.home-unit-seal {
    width: 4.25rem;
    height: 4.25rem;
    background: var(--manga-ink);
    color: var(--manga-paper);
    clip-path: polygon(0 0, 100% 0, 100% 72%, 72% 100%, 0 100%);
    box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent-main) 65%, transparent);
}

.home-editor-frame {
    border-radius: 2px;
    box-shadow: var(--shadow-panel);
    clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);
}

.home-editor-frame::before {
    position: absolute;
    z-index: 2;
    top: 0;
    right: 17px;
    width: 1px;
    height: 26px;
    background: var(--border-strong);
    content: "";
    transform: rotate(-45deg);
    transform-origin: top;
    pointer-events: none;
}

.home-editor-rail {
    background: color-mix(in srgb, var(--bg-panel) 82%, var(--accent-bg));
}

.home-manuscript {
    background-image: linear-gradient(
        to bottom,
        transparent calc(1.65rem - 1px),
        color-mix(in srgb, var(--border-color) 40%, transparent) calc(1.65rem - 1px),
        color-mix(in srgb, var(--border-color) 40%, transparent) 1.65rem
    );
    background-size: 100% 1.65rem;
}

.home-action-bar {
    position: relative;
}

.home-action-bar::before {
    position: absolute;
    top: 0;
    left: 0;
    width: 5rem;
    height: 2px;
    background: var(--accent-pop);
    content: "";
}

.home-primary-action {
    border-radius: 2px;
    clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%);
    box-shadow: 4px 4px 0 color-mix(in srgb, var(--manga-ink) 24%, transparent);
}

.home-primary-action:active {
    transform: translate(2px, 2px);
    box-shadow: 2px 2px 0 color-mix(in srgb, var(--manga-ink) 24%, transparent);
}

.history-card,
.history-collapsed {
    position: relative;
    border-radius: 3px;
    box-shadow: 4px 4px 0 color-mix(in srgb, var(--manga-ink) 7%, transparent);
}

.history-card::before {
    position: absolute;
    top: -1px;
    left: -1px;
    width: 2.75rem;
    height: 3px;
    background: var(--accent-main);
    content: "";
}

.registry-rail {
    border-radius: 3px;
    box-shadow: 5px 5px 0 color-mix(in srgb, var(--manga-ink) 7%, transparent);
}

@media (max-width: 639px) {
    .home-stage {
        justify-content: flex-start;
        padding-top: 1.5rem;
    }

    .home-heading {
        padding-left: 0.75rem;
    }

    .home-manuscript {
        min-height: 18rem;
        height: 42vh;
    }

    .home-speed-cut {
        width: 5rem;
        opacity: 0.55;
    }
}

@media (prefers-reduced-motion: reduce) {
    .home-primary-action,
    .history-card,
    .history-collapsed {
        transition: none;
    }
}
</style>

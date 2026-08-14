<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import {resolveApiErrorMessage} from "../utils/api-error";
import {useAuthState} from "../composables/useAuthState";
import type {StyleReviewItem, StyleReviewListResponse} from "../../server/utils/style-review";

type StyleReviewJudgmentResponse = {
    judgmentId: string;
    blind: true;
};
type ReviewDraft = {
    aiFlavor: number;
    wantReadOn: number;
    comment: string;
};

type ReviewState = "idle" | "submitting" | "revealed";

type ErrorShape = {
    status?: unknown;
    statusCode?: unknown;
    data?: {status?: unknown; statusCode?: unknown; message?: unknown};
};

/** 登录开启时沿用私有工作台的路由保护；关闭登录时服务端提供本地开发身份。 */
definePageMeta({
    middleware: async (to) => {
        const auth = useAuthState();
        const user = auth.loaded.value ? auth.user.value : await auth.refresh().catch(() => null);
        if (auth.authEnabled.value && !user) {
            return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
        }
    },
});

const items = ref<StyleReviewItem[]>([]);
const activeBlindId = ref<string | null>(null);
const loading = ref(true);
const pageError = ref("");
const actionError = ref("");
const drafts = reactive<Record<string, ReviewDraft>>({});
const reviewStates = reactive<Record<string, ReviewState>>({});
const storageKey = "neurobook.style-review.v2.light-novel.progress";

const scores = [0, 1, 2, 3, 4, 5] as const;
const groups = computed(() => {
    const grouped = new Map<string, StyleReviewItem[]>();
    for (const item of items.value) {
        const group = grouped.get(item.pairRef) ?? [];
        group.push(item);
        grouped.set(item.pairRef, group);
    }
    return [...grouped.values()].map((groupItems, index) => ({
        key: groupItems[0]?.pairRef ?? `group-${index}`,
        label: `题组 ${String(index + 1).padStart(2, "0")}`,
        items: groupItems,
    }));
});

const activeItem = computed(() => items.value.find((item) => item.blindId === activeBlindId.value) ?? null);
const activeDraft = computed(() => activeItem.value ? drafts[activeItem.value.blindId] ?? null : null);
const activeState = computed<ReviewState>(() => activeItem.value ? reviewStates[activeItem.value.blindId] ?? "idle" : "idle");
const activeGroup = computed(() => groups.value.find((group) => group.items.some((item) => item.blindId === activeBlindId.value)) ?? null);
const activeSampleNumber = computed(() => {
    const index = activeGroup.value?.items.findIndex((item) => item.blindId === activeBlindId.value) ?? -1;
    return index >= 0 ? index + 1 : 0;
});
const completedCount = computed(() => items.value.filter((item) => reviewStates[item.blindId] === "revealed").length);
const progressPercent = computed(() => items.value.length === 0 ? 0 : Math.round((completedCount.value / items.value.length) * 100));
const canSubmit = computed(() => activeItem.value !== null && activeDraft.value !== null && activeState.value === "idle");

function errorStatus(error: unknown): number | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }
    const shape = error as ErrorShape;
    const nested = shape.data;
    const status = shape.statusCode ?? shape.status ?? nested?.statusCode ?? nested?.status;
    return typeof status === "number" ? status : null;
}

function readableError(error: unknown, fallback: string): string {
    const status = errorStatus(error);
    if (status === 401) return "当前评测需要登录。请先登录，再回来继续盲评。";
    if (status === 403) return "你没有权限访问这组私有评测，请确认当前账号已被邀请。";
    return resolveApiErrorMessage(error, fallback);
}

function persistProgress(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(storageKey, JSON.stringify({drafts, reviewStates}));
}

function restoreProgress(): void {
    if (typeof localStorage === "undefined") return;
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {drafts?: Record<string, ReviewDraft>} | null;
        for (const item of items.value) {
            if (item.myJudgment) {
                reviewStates[item.blindId] = "revealed";
                drafts[item.blindId] = {
                    aiFlavor: item.myJudgment.aiFlavor ?? 3,
                    wantReadOn: item.myJudgment.wantReadOn ?? 3,
                    comment: item.myJudgment.comment ?? "",
                };
                continue;
            }

            // 服务端没有本用户判定时，旧缓存只能恢复未提交草稿，不能恢复“已完成”状态。
            reviewStates[item.blindId] = "idle";
            const savedDraft = saved?.drafts?.[item.blindId];
            if (savedDraft && typeof savedDraft.comment === "string" && Number.isInteger(savedDraft.aiFlavor) && Number.isInteger(savedDraft.wantReadOn)) {
                drafts[item.blindId] = savedDraft;
            }
        }
    } catch {
        localStorage.removeItem(storageKey);
    }
}

function initialiseItem(item: StyleReviewItem): void {
    if (item.myJudgment) {
        reviewStates[item.blindId] = "revealed";
        drafts[item.blindId] = {
            aiFlavor: item.myJudgment.aiFlavor ?? 3,
            wantReadOn: item.myJudgment.wantReadOn ?? 3,
            comment: item.myJudgment.comment ?? "",
        };
        return;
    }

    reviewStates[item.blindId] = "idle";
    drafts[item.blindId] ??= {aiFlavor: 3, wantReadOn: 3, comment: ""};
}

async function loadReviews(): Promise<void> {
    loading.value = true;
    pageError.value = "";
    try {
        const response = await $fetch<StyleReviewListResponse>("/api/style-review");
        items.value = response.items;
        for (const item of response.items) initialiseItem(item);
        restoreProgress();
        activeBlindId.value = response.items.find((item) => reviewStates[item.blindId] !== "revealed")?.blindId ?? response.items[0]?.blindId ?? null;
    } catch (error) {
        pageError.value = readableError(error, "私有评测暂时无法加载，请稍后再试。");
    } finally {
        loading.value = false;
    }
}

function selectItem(item: StyleReviewItem): void {
    activeBlindId.value = item.blindId;
    actionError.value = "";
}

function selectScore(axis: "aiFlavor" | "wantReadOn", score: number): void {
    if (activeState.value !== "idle" || !activeDraft.value) return;
    activeDraft.value[axis] = score;
    persistProgress();
}
function scoreLabel(axis: "aiFlavor" | "wantReadOn", score: number): string {
    if (axis === "aiFlavor") return `AI 味 ${score} 分`;
    return `想读下去 ${score} 分`;
}

function stateLabel(state: ReviewState): string {
    return state === "revealed" ? "已完成" : state === "submitting" ? "正在保存" : "待评";
}

function editReview(): void {
    const item = activeItem.value;
    if (!item || activeState.value !== "revealed") return;
    reviewStates[item.blindId] = "idle";
    persistProgress();
}

async function submitReview(): Promise<void> {
    const item = activeItem.value;
    const draft = activeDraft.value;
    if (!item || !draft || !canSubmit.value) return;
    actionError.value = "";
    reviewStates[item.blindId] = "submitting";
    const body: {blindId: string; aiFlavor: number; wantReadOn: number; comment?: string} = {
        blindId: item.blindId,
        aiFlavor: draft.aiFlavor,
        wantReadOn: draft.wantReadOn,
    };
    if (draft.comment.trim()) body.comment = draft.comment.trim();
    try {
        await $fetch<StyleReviewJudgmentResponse>("/api/style-review/judgment", {method: "POST", body});
        reviewStates[item.blindId] = "revealed";
        persistProgress();
        selectNextItem();
    } catch (error) {
        reviewStates[item.blindId] = "idle";
        persistProgress();
        actionError.value = readableError(error, "评分没有保存，请检查网络后再试。");
    }
}

function selectNextItem(): void {
    const currentIndex = items.value.findIndex((item) => item.blindId === activeBlindId.value);
    if (currentIndex < 0) return;
    const next = items.value.slice(currentIndex + 1).find((item) => reviewStates[item.blindId] !== "revealed")
        ?? items.value.find((item) => reviewStates[item.blindId] !== "revealed");
    if (next) selectItem(next);
}

onMounted(() => void loadReviews());
</script>

<template>
    <div class="review-page flex min-h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <main class="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <section class="review-intro mb-6 grid gap-5 border-b border-[var(--border-color)] pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-end">
                <div>
                    <div class="mb-3 flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.16em] text-[var(--accent-text)]"><span class="h-2 w-2 rounded-full bg-[var(--accent-pop)]" />PRIVATE EDITION / STYLE REVIEW</div>
                    <h1 class="review-title text-3xl font-black tracking-tight sm:text-4xl">编辑部校样台</h1>
                    <p class="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-secondary)] sm:text-base">这里收集的是同一组题目的匿名稿件。请像编辑做初读一样，先读完整，再凭直觉给出分数。</p>
                </div>
                <div class="grid gap-2 border-l-2 border-[var(--accent-signal)] pl-4 text-sm text-[var(--text-secondary)]">
                    <div class="flex items-center gap-2 font-semibold text-[var(--text-main)]"><span class="i-lucide-eye-off h-4 w-4 text-[var(--accent-signal)]" />全程匿名，完成后统一汇总</div>
                    <p class="text-xs leading-5 text-[var(--text-muted)]">提交后只锁定本份评分，不显示候选标签，避免影响后续判断。</p>
                </div>
            </section>

            <div v-if="loading" class="grid min-h-[28rem] place-items-center border border-[var(--border-color)] bg-[var(--bg-panel)] p-8" aria-live="polite"><div class="grid justify-items-center gap-3 text-center"><span class="i-lucide-loader-circle h-7 w-7 animate-spin text-[var(--accent-main)]" /><p class="text-sm text-[var(--text-secondary)]">正在整理匿名校样……</p></div></div>
            <div v-else-if="pageError" class="grid min-h-[28rem] place-items-center border border-[var(--status-danger)]/35 bg-[var(--bg-panel)] p-8" role="alert"><div class="grid max-w-md justify-items-center gap-4 text-center"><span class="i-lucide-lock-keyhole h-8 w-8 text-[var(--status-danger)]" /><div class="grid gap-2"><h2 class="font-semibold">无法打开私有评测</h2><p class="text-sm leading-6 text-[var(--text-secondary)]">{{ pageError }}</p></div><button type="button" class="inline-flex h-9 items-center gap-2 border border-[var(--border-strong)] bg-[var(--bg-input)] px-4 text-sm font-semibold hover:border-[var(--accent-main)] hover:bg-[var(--bg-hover)]" @click="loadReviews"><span class="i-lucide-rotate-ccw h-4 w-4" />重试</button></div></div>
            <div v-else-if="items.length === 0" class="grid min-h-[28rem] place-items-center border border-[var(--border-color)] bg-[var(--bg-panel)] p-8" aria-live="polite"><div class="grid max-w-md justify-items-center gap-3 text-center"><span class="i-lucide-inbox h-8 w-8 text-[var(--text-muted)]" /><h2 class="font-semibold">暂时没有待评校样</h2><p class="text-sm leading-6 text-[var(--text-secondary)]">私有评测池还没有可供初读的样本。</p></div></div>
            <div v-else class="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_20rem] xl:gap-6">
                <aside class="review-sidebar border border-[var(--border-color)] bg-[var(--bg-panel)] lg:sticky lg:top-20">
                    <div class="border-b border-[var(--border-color)] px-4 py-4"><div class="flex items-baseline justify-between gap-3"><h2 class="text-sm font-bold">评测目录</h2><span class="font-mono text-[10px] text-[var(--text-muted)]">{{ completedCount }}/{{ items.length }} 已完成</span></div><div class="mt-3 h-1 overflow-hidden bg-[var(--bg-subtle)]"><div class="h-full bg-[var(--accent-main)] transition-[width] duration-300" :style="{width: `${progressPercent}%`}" /></div></div>
                    <nav class="max-h-[28rem] overflow-y-auto p-2" aria-label="匿名样本导航"><section v-for="group in groups" :key="group.key" class="mb-4 last:mb-0"><div class="flex items-center justify-between px-2 pb-1.5 text-[10px] font-bold tracking-[0.12em] text-[var(--text-muted)]"><span>{{ group.label }}</span><span>{{ group.items.length }} 份</span></div><button v-for="(item, index) in group.items" :key="item.blindId" type="button" class="group flex w-full items-center gap-2 border-l-2 px-2 py-2 text-left text-sm transition hover:bg-[var(--bg-hover)]" :class="item.blindId === activeBlindId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--text-main)]' : 'border-transparent text-[var(--text-secondary)]'" :aria-current="item.blindId === activeBlindId ? 'page' : undefined" @click="selectItem(item)"><span class="font-mono text-[10px] text-[var(--text-muted)]">{{ String(index + 1).padStart(2, "0") }}</span><span class="min-w-0 flex-1 truncate">匿名样本</span><span class="shrink-0 text-[10px]" :class="reviewStates[item.blindId] === 'revealed' ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)]'" :title="stateLabel(reviewStates[item.blindId] ?? 'idle')"><span v-if="reviewStates[item.blindId] === 'revealed'" class="i-lucide-check-circle-2 h-3.5 w-3.5" /><span v-else>·</span></span></button></section></nav>
                </aside>

                <section v-if="activeItem" class="review-manuscript min-w-0 border border-[var(--border-color)] bg-[var(--bg-panel)]" aria-labelledby="manuscript-title">
                    <header class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-color)] px-5 py-4 sm:px-7"><div><div class="font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--accent-text)]">{{ activeGroup?.label ?? "校样" }} / {{ String(activeSampleNumber).padStart(2, "0") }}</div><h2 id="manuscript-title" class="mt-1 text-lg font-bold">匿名校样</h2></div><div class="flex items-center gap-2 text-xs text-[var(--text-muted)]"><span class="i-lucide-file-text h-3.5 w-3.5" /><span>{{ activeItem.charCount.toLocaleString() }} 字</span></div></header>
                    <article class="review-body px-5 py-7 text-[1.02rem] leading-[2.05] text-[var(--text-main)] sm:px-10 sm:py-10 sm:text-[1.08rem]"><p class="whitespace-pre-wrap break-words">{{ activeItem.body }}</p></article>
                    <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-color)] bg-[var(--bg-subtle)] px-5 py-3 text-xs text-[var(--text-muted)] sm:px-7"><span>读到这里，再打开右侧评分卡。</span><button v-if="items.length > 1" type="button" class="inline-flex items-center gap-1 font-semibold text-[var(--accent-text)] hover:text-[var(--text-main)]" @click="selectNextItem">下一份样本 <span class="i-lucide-arrow-right h-3.5 w-3.5" /></button></footer>
                </section>

                <aside v-if="activeItem && activeDraft" class="review-scorecard border border-[var(--border-strong)] bg-[var(--bg-panel)] lg:sticky lg:top-20" aria-labelledby="scorecard-title">
                    <div class="border-b border-[var(--border-color)] bg-[var(--bg-subtle)] px-4 py-4"><div class="flex items-start justify-between gap-3"><div><div class="font-mono text-[10px] font-bold tracking-[0.12em] text-[var(--accent-pop)]">EDITOR'S NOTE</div><h2 id="scorecard-title" class="mt-1 text-base font-bold">初读记录</h2></div><div class="flex items-center gap-2"><button v-if="activeState === 'revealed'" type="button" class="inline-flex h-7 items-center gap-1 border border-[var(--border-color)] px-2 text-[10px] font-semibold text-[var(--text-secondary)] hover:border-[var(--accent-main)] hover:text-[var(--text-main)]" @click="editReview"><span class="i-lucide-pencil h-3 w-3" />重新评分</button><span class="rounded-full border border-[var(--border-color)] px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)]">{{ stateLabel(activeState) }}</span></div></div><p class="mt-2 text-xs leading-5 text-[var(--text-secondary)]">不用猜测标准答案，只记录你读完后的真实感受。</p></div>
                    <form class="grid gap-5 p-4" @submit.prevent="submitReview">
                        <fieldset class="grid gap-2" :disabled="activeState !== 'idle'"><legend class="flex items-center gap-2 text-sm font-semibold"><span class="i-lucide-flame h-4 w-4 text-[var(--accent-pop)]" />AI 味 <span class="ml-auto font-mono text-xs text-[var(--accent-pop)]">{{ activeDraft.aiFlavor }}/5</span></legend><div class="grid grid-cols-6 gap-1.5" role="group" aria-label="AI 味评分"><button v-for="score in scores" :key="`ai-${score}`" type="button" class="score-button h-9 border text-sm font-bold transition" :class="activeDraft.aiFlavor === score ? 'border-[var(--accent-pop)] bg-[var(--accent-pop)] text-[var(--text-inverse)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:border-[var(--accent-pop)] hover:text-[var(--text-main)]'" :title="scoreLabel('aiFlavor', score)" @click="selectScore('aiFlavor', score)">{{ score }}</button></div><p class="text-[10px] leading-4 text-[var(--text-muted)]">0 = 完全不像 AI；5 = AI 痕迹很重。</p></fieldset>
                        <fieldset class="grid gap-2" :disabled="activeState !== 'idle'"><legend class="flex items-center gap-2 text-sm font-semibold"><span class="i-lucide-heart h-4 w-4 text-[var(--accent-main)]" />想读下去 <span class="ml-auto font-mono text-xs text-[var(--accent-main)]">{{ activeDraft.wantReadOn }}/5</span></legend><div class="grid grid-cols-6 gap-1.5" role="group" aria-label="想读下去评分"><button v-for="score in scores" :key="`read-${score}`" type="button" class="score-button h-9 border text-sm font-bold transition" :class="activeDraft.wantReadOn === score ? 'border-[var(--accent-main)] bg-[var(--accent-main)] text-[var(--text-inverse)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:border-[var(--accent-main)] hover:text-[var(--text-main)]'" :title="scoreLabel('wantReadOn', score)" @click="selectScore('wantReadOn', score)">{{ score }}</button></div><p class="text-[10px] leading-4 text-[var(--text-muted)]">0 = 不想继续；5 = 很想继续，也是本轮舒服度主判据。</p></fieldset>
                        <label class="grid gap-2"><span class="flex items-center justify-between gap-2 text-sm font-semibold"><span>给编辑的一句话</span><span class="font-mono text-[10px] font-normal text-[var(--text-muted)]">可选 · {{ activeDraft.comment.length }}/4000</span></span><textarea v-model="activeDraft.comment" :disabled="activeState !== 'idle'" class="min-h-28 resize-y border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5 text-sm leading-5 text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]" maxlength="4000" placeholder="哪一处让你想继续读？哪一处让你出戏？" @input="persistProgress" /></label>
                        <p v-if="actionError" class="border border-[var(--status-danger)]/35 bg-[var(--status-danger)]/8 px-3 py-2.5 text-xs leading-5 text-[var(--status-danger)]" role="alert">{{ actionError }}</p>
                        <div class="grid gap-2"><button type="submit" class="inline-flex h-10 items-center justify-center gap-2 bg-[var(--accent-main)] px-4 text-sm font-bold text-[var(--text-inverse)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55" :disabled="!canSubmit"><span v-if="activeState === 'submitting'" class="i-lucide-loader-circle h-4 w-4 animate-spin" /><span v-else-if="activeState === 'revealed'" class="i-lucide-check-circle-2 h-4 w-4" /><span v-else class="i-lucide-clipboard-pen-line h-4 w-4" /><span>{{ activeState === "submitting" ? "正在保存评分" : activeState === "revealed" ? "本份已完成" : "提交本份评分" }}</span></button><p class="text-center text-[10px] leading-4 text-[var(--text-muted)]">提交后评分会覆盖你对同一份样本的上一次记录。</p></div>
                    </form>
                </aside>
            </div>
        </main>
    </div>
</template>

<style scoped>
.review-page { position: relative; isolation: isolate; }
.review-page::before { position: fixed; z-index: -1; inset: 3rem 0 0; background: linear-gradient(90deg, color-mix(in srgb, var(--accent-main) 5%, transparent), transparent 34%, color-mix(in srgb, var(--accent-pop) 4%, transparent)); content: ""; pointer-events: none; }
.review-title { text-wrap: balance; }
.review-body { font-family: "Noto Serif SC", "Songti SC", "STSong", serif; }
.review-manuscript, .review-sidebar, .review-scorecard { box-shadow: var(--shadow-panel); }
.score-button:disabled { cursor: not-allowed; }
@media (max-width: 1023px) { .review-sidebar nav { max-height: none; } }
</style>

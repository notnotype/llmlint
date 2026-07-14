<script setup lang="ts">
// 检测历史入口（Task 15 P1-C，draft 屏「我的检测历史」）：消费 GET /api/texts（当前用户，
// 登录关闭时使用稳定本地开发用户，开启时使用 session 用户），点某篇 emit open(textId)，宿主
// hydrateWorkspace 恢复工作台。挂载时拉取（「再传一篇」回到 draft 屏即重挂刷新）。
import {onMounted, ref} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {resolveApiErrorMessage} from "../utils/api-error";
import type {TextHistoryItem} from "../utils/contribute-workspace";

const props = defineProps<{
    /** 宿主恢复请求进行中：整个列表禁点防连点（恢复动作是宿主的全局状态覆盖）。 */
    busy: boolean;
}>();
const emit = defineEmits<{
    /** 点开某篇：宿主拉工作台恢复端点并重建流程状态。 */
    (e: "open", textId: string): void;
}>();

const {t} = useLlmlintI18n();

const items = ref<TextHistoryItem[]>([]);
const loading = ref(false);
// 非 null = 列表加载失败文案（入口内可恢复的局部 error state，带重试按钮）。
const error = ref<string | null>(null);

/** 拉取历史列表（挂载时自动跑；失败后可点「重试」重跑）。 */
async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        items.value = await $fetch<TextHistoryItem[]>("/api/texts");
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, t("contribute.historyLoadFailed"));
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void load();
});

/** 上传时间的本地化短显示（列表次要信息，无需相对时间）。 */
function formatTime(iso: string): string {
    return new Date(iso).toLocaleString();
}
</script>

<template>
    <!-- 历史列表区：标题 + 状态（加载/失败/空）+ 条目按钮 + 匿名会话提示 -->
    <section class="grid gap-2">
        <h2 class="text-sm font-semibold">{{ t("contribute.historyTitle") }}</h2>
        <div v-if="loading" class="text-xs text-[var(--text-muted)]">{{ t("contribute.historyLoading") }}</div>
        <div v-else-if="error" class="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <span>{{ error }}</span>
            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2.5 hover:bg-[var(--bg-hover)]" @click="load">
                <span class="i-lucide-rotate-ccw h-3 w-3" /> {{ t("common.retry") }}
            </button>
        </div>
        <div v-else-if="items.length === 0" class="text-xs text-[var(--text-muted)]">{{ t("contribute.historyEmpty") }}</div>
        <ul v-else class="grid gap-1.5">
            <li v-for="item in items" :key="item.textId">
                <button type="button" class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-left text-sm transition hover:border-[var(--accent-main)] disabled:cursor-not-allowed disabled:opacity-60" :disabled="props.busy" :title="t('contribute.historyOpenTitle')" @click="emit('open', item.textId)">
                    <span class="min-w-0 flex-1 truncate font-medium">{{ item.preview || t("contribute.notProvided") }}</span>
                    <span class="shrink-0 text-xs text-[var(--text-muted)]">{{ t("contribute.historyRevisionCount", {count: item.revisionCount}) }}</span>
                    <!-- D2：head 未揭示（或无扫描）时 docScore 恒 null，显示「未揭示」 -->
                    <span class="shrink-0 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{{ item.latestDocScore !== null ? t("contribute.historyDocScore", {score: item.latestDocScore.toFixed(1)}) : t("contribute.historyNotRevealed") }}</span>
                    <span class="shrink-0 text-xs text-[var(--text-muted)]">{{ formatTime(item.createdAt) }}</span>
                </button>
            </li>
        </ul>
        <!-- 历史归属提示：随当前配置解析出的登录/本地开发身份保存 -->
        <p class="text-xs text-[var(--text-muted)]">{{ t("contribute.historyAnonymousNote") }}</p>
    </section>
</template>

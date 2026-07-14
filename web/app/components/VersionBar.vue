<script setup lang="ts">
// 版本条（Task 15 P0-A）：可点击 rev 链（复用 LineageStrip 的 clickable 模式）+ 未提交草稿指示 +
// 「再次检测」主按钮（= 原「提交改后版本」commitRevision 的重命名迁位：保存草稿为新版本并重新检测）。
// 纯展示组件：版本切换与提交动作全部 emit 给宿主，谱系/草稿状态由宿主维护。
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import LineageStrip, {type LineageEntry} from "./LineageStrip.vue";

const props = defineProps<{
    /** rev 链（按 ordinal 升序）。 */
    entries: LineageEntry[];
    /** 最新版本 ordinal。 */
    headOrdinal: number;
    /** 当前查看版本 ordinal（chip 高亮）。 */
    activeOrdinal: number;
    /** 草稿 ≠ head 正文：显示未提交草稿指示 +「再次检测」可用。 */
    draftDirty: boolean;
    /** 提交中（「再次检测」loading 态）。 */
    committing: boolean;
    /** 宿主追加的提交禁用条件（AI 改写等待期等，防跨态竞态）。 */
    commitDisabled?: boolean;
}>();

const emit = defineEmits<{
    /** 点击某版本 chip：旧版 → 只读查看；head → 回编辑器。 */
    (e: "select", ordinal: number): void;
    /** 「再次检测」：保存当前草稿为新版本 → 服务端扫描/检测 → 版本条追加并刷新报告。 */
    (e: "commit"): void;
}>();

const {t} = useLlmlintI18n();
</script>

<template>
    <!-- 版本条：rev 链（可点击）+ 草稿指示 + 再次检测主按钮 -->
    <div class="flex min-w-0 flex-wrap items-center gap-2">
        <LineageStrip :entries="props.entries" :head-ordinal="props.headOrdinal" :active-ordinal="props.activeOrdinal" clickable @select="(ordinal) => emit('select', ordinal)" />
        <!-- 未提交草稿指示：head 之上有未保存改动（warning 色） -->
        <span v-if="props.draftDirty" class="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300" :title="t('contribute.versionDraftTitle')">{{ t("contribute.versionDraftChip") }}</span>
        <button type="button" class="ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-white hover:brightness-105 disabled:opacity-60" :title="t('contribute.recheckTitle')" :disabled="!props.draftDirty || props.committing || props.commitDisabled" @click="emit('commit')">
            <span class="i-lucide-refresh-cw" /> {{ props.committing ? t("contribute.committing") : t("contribute.recheckButton") }}
        </button>
    </div>
</template>

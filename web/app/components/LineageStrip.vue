<script setup lang="ts">
// 谱系/版本 chips（Task 13 W8 G4 → Task 15 P0-A 升级）：rev 链「rev0 原文 → rev1 静态清理 → …」，
// transitionKind 四类各一标签色（类别识别色）。两种用法：
// ① 纯展示（总结卡）：只传 entries + headOrdinal，高亮 head；
// ② 可点击版本切换（VersionBar）：加 clickable + activeOrdinal，高亮当前查看版本、点击 emit select。
// 纯展示组件：谱系数组由宿主维护，本组件不自持流程状态。
import {computed} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import type {MessageKey} from "../i18n/messages";

/** 谱系一环：ordinal = revision 序号；transitionKind = 这一版怎么来的（rev0 恒 upload，schema 同名 enum）。 */
export type LineageEntry = {
    ordinal: number;
    transitionKind: "upload" | "static_fix" | "llm_fix" | "user_fix";
};

const props = defineProps<{
    /** rev 链（按 ordinal 升序）。 */
    entries: LineageEntry[];
    /** 当前 head 的 ordinal（最新版本）。 */
    headOrdinal: number;
    /** 当前查看版本（可点击模式的高亮源）；缺省 = headOrdinal（原纯展示语义）。 */
    activeOrdinal?: number | null;
    /** 可点击切换版本（VersionBar 用）；纯展示场景不传。 */
    clickable?: boolean;
}>();

const emit = defineEmits<{
    /** 点击某版本 chip（仅 clickable 模式）。 */
    (e: "select", ordinal: number): void;
}>();

const {t} = useLlmlintI18n();

// 高亮的 ordinal：可点击模式跟随 activeOrdinal（查看中的版本），否则沿用 head。
const highlightOrdinal = computed(() => props.activeOrdinal ?? props.headOrdinal);

// transitionKind → 文案 key + 标签色：upload 中性 / static 蓝 / llm 紫 / user 绿（四类各一色，类别识别用）。
const kindPresentation: Record<LineageEntry["transitionKind"], {labelKey: MessageKey; chipClass: string}> = {
    upload: {labelKey: "contribute.lineageKindUpload", chipClass: "border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-muted)]"},
    static_fix: {labelKey: "contribute.lineageKindStatic", chipClass: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"},
    llm_fix: {labelKey: "contribute.lineageKindLlm", chipClass: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"},
    user_fix: {labelKey: "contribute.lineageKindUser", chipClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"},
};

/** chip 的 title：可点击 → 查看提示（head 另注明回到编辑器）；纯展示 → 仅当前版本注明。 */
function chipTitle(entry: LineageEntry): string | undefined {
    if (props.clickable) {
        return entry.ordinal === props.headOrdinal ? t("contribute.versionViewHeadTitle") : t("contribute.versionViewTitle", {ordinal: entry.ordinal});
    }
    return entry.ordinal === highlightOrdinal.value ? t("contribute.lineageCurrentTitle") : undefined;
}
</script>

<template>
    <!-- 谱系/版本条：标签 + rev 链 chips（高亮 = 查看中的版本；clickable 模式可点切换） -->
    <div class="flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-[var(--text-muted)]">{{ t("contribute.lineageLabel") }}</span>
        <template v-for="(entry, i) in props.entries" :key="entry.ordinal">
            <span v-if="i > 0" class="text-[var(--text-muted)]">→</span>
            <button v-if="props.clickable" type="button" class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition hover:brightness-110" :class="[kindPresentation[entry.transitionKind].chipClass, entry.ordinal === highlightOrdinal ? 'ring-1 ring-[var(--accent-main)]' : '']" :title="chipTitle(entry)" @click="emit('select', entry.ordinal)">
                <span class="font-mono">rev{{ entry.ordinal }}</span>
                <span>{{ t(kindPresentation[entry.transitionKind].labelKey) }}</span>
            </button>
            <span v-else class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5" :class="[kindPresentation[entry.transitionKind].chipClass, entry.ordinal === highlightOrdinal ? 'ring-1 ring-[var(--accent-main)]' : '']" :title="chipTitle(entry)">
                <span class="font-mono">rev{{ entry.ordinal }}</span>
                <span>{{ t(kindPresentation[entry.transitionKind].labelKey) }}</span>
            </span>
        </template>
    </div>
</template>

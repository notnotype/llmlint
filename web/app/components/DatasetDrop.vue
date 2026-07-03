<script setup lang="ts">
import {ref} from "vue";

// 拖入/点击选择 dataset.json → emit file；解析交给父组件（useDataset.loadFile）。
// 与 ReportDrop 同构，但文案强调「本地专用、含版权正文」。主题走 CSS 变量。
defineProps<{error?: string}>();
const emit = defineEmits<{(e: "file", file: File): void}>();

const dragOver = ref(false);
const input = ref<HTMLInputElement | null>(null);

function onDrop(event: DragEvent) {
    dragOver.value = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
        emit("file", file);
    }
}
function onPick(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
        emit("file", file);
    }
}
</script>

<template>
    <!-- 数据集拖放区（本地专用） -->
    <div class="mx-auto max-w-2xl">
        <div
            class="cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors"
            :class="dragOver ? 'border-[var(--accent-main)] bg-[var(--bg-hover)]' : 'border-[var(--border-color)] hover:border-[var(--text-muted)]'"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="onDrop"
            @click="input?.click()"
        >
            <div class="text-4xl text-[var(--text-muted)]">⬆</div>
            <p class="mt-3 text-[var(--text-main)]">拖入 <code class="rounded bg-[var(--bg-subtle)] px-1">dataset.json</code>，或点击选择</p>
            <p class="mt-1 text-xs text-[var(--text-muted)]">由 <code>bun evals/dataset.ts</code> 生成 · 纯浏览器渲染、不上传</p>
            <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">⚠ 含版权正文，仅本地查看，勿分发</p>
            <input ref="input" type="file" accept="application/json,.json" class="hidden" @change="onPick" >
        </div>
        <p v-if="error" class="mt-3 text-center text-sm text-red-600 dark:text-red-400">解析失败：{{ error }}</p>
    </div>
</template>

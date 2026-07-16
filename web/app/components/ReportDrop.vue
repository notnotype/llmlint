<script setup lang="ts">
import {ref} from "vue";

// 拖入/点击选择 report.json → emit file；解析交给父组件（useReport.loadFile）。
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
    <!-- 报告拖放区 -->
    <div class="w-full">
        <div
            class="dropzone cursor-pointer border-2 border-dashed bg-[var(--bg-panel)] px-6 py-12 text-center transition-colors"
            :class="dragOver ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-strong)] hover:border-[var(--accent-main)]'"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="onDrop"
            @click="input?.click()"
        >
            <span class="i-lucide-upload mx-auto block h-9 w-9 text-[var(--accent-main)]" />
            <p class="mt-4 text-[var(--text-main)]">拖入 <code class="bg-[var(--bg-subtle)] px-1">report.json</code>，或点击选择</p>
            <p class="mt-1 text-xs text-[var(--text-muted)]">由 <code>bun evals/score.ts</code> 生成，纯浏览器渲染、不上传</p>
            <input ref="input" type="file" accept="application/json,.json" class="hidden" @change="onPick" >
        </div>
        <p v-if="error" class="mt-3 text-center text-sm text-red-600 dark:text-red-400">解析失败：{{ error }}</p>
    </div>
</template>

<style scoped>
.dropzone {
    border-radius: 3px;
    clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%);
}
</style>

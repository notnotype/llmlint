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
    <div class="mx-auto max-w-2xl">
        <div
            class="cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors"
            :class="dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="onDrop"
            @click="input?.click()"
        >
            <div class="text-4xl text-zinc-400">⬆</div>
            <p class="mt-3 text-zinc-700 dark:text-zinc-200">拖入 <code class="rounded bg-zinc-100 px-1 dark:bg-zinc-800">report.json</code>，或点击选择</p>
            <p class="mt-1 text-xs text-zinc-500">由 <code>bun evals/score.ts</code> 生成，纯浏览器渲染、不上传</p>
            <input ref="input" type="file" accept="application/json,.json" class="hidden" @change="onPick" >
        </div>
        <p v-if="error" class="mt-3 text-center text-sm text-red-600 dark:text-red-400">解析失败：{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
const props = defineProps<{
    modelValue: boolean;
    label: string;
}>();
const emit = defineEmits<{(e: "update:modelValue", value: boolean): void}>();
</script>

<template>
    <button type="button" class="flex w-full items-center justify-between gap-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-left hover:bg-[var(--bg-hover)]" @click="emit('update:modelValue', !props.modelValue)">
        <span class="text-sm text-[var(--text-main)]">{{ label }}</span>
        <span class="relative h-5 w-9 rounded-full border transition-colors" :class="props.modelValue ? 'border-[var(--accent-main)] bg-[var(--accent-main)]' : 'border-[var(--border-strong)] bg-[var(--bg-subtle)]'">
            <span class="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform" :class="props.modelValue ? 'translate-x-[18px]' : 'translate-x-0.5'"></span>
        </span>
    </button>
</template>

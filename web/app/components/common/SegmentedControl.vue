<script setup lang="ts">
export type SegmentedValue = string | number | boolean;
export type SegmentedOption = {
    value: SegmentedValue;
    label: string;
    title?: string;
    disabled?: boolean;
};

const props = defineProps<{
    modelValue: SegmentedValue;
    options: SegmentedOption[];
}>();
const emit = defineEmits<{(e: "update:modelValue", value: SegmentedValue): void}>();
</script>

<template>
    <div class="inline-flex max-w-full flex-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-0.5">
        <button
            v-for="option in props.options"
            :key="`${typeof option.value}:${String(option.value)}`"
            type="button"
            class="inline-flex h-7 min-w-0 items-center justify-center rounded px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            :class="option.value === props.modelValue ? 'bg-[var(--bg-panel)] text-[var(--text-main)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
            :title="option.title"
            :disabled="option.disabled"
            :aria-label="option.title ?? option.label"
            :aria-pressed="option.value === props.modelValue"
            @click="emit('update:modelValue', option.value)"
        >
            <span class="truncate">{{ option.label }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
    title?: string;
    disabled?: boolean;
    tone?: "default" | "danger";
}>(), {
    title: "",
    disabled: false,
    tone: "default",
});
</script>

<template>
    <button
        type="button"
        :title="props.title"
        :disabled="props.disabled"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-45"
        :class="props.tone === 'danger' ? 'text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
    >
        <slot />
    </button>
</template>

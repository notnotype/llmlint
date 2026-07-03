<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, watch} from "vue";
import {LLMLINT_THEME_HOST_CLASS} from "../../utils/theme/theme-tokens";
import {useLlmlintI18n} from "../../composables/useLlmlintI18n";
import IconButton from "./IconButton.vue";

const props = withDefaults(defineProps<{
    modelValue: boolean;
    title?: string;
    width?: string;
    closeOnOverlay?: boolean;
    showFooter?: boolean;
}>(), {
    title: "",
    width: "min(560px, calc(100vw - 32px))",
    closeOnOverlay: true,
    showFooter: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "confirm"): void;
}>();
const {t} = useLlmlintI18n();
const mounted = ref(false);

function close(): void {
    emit("update:modelValue", false);
}

function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && props.modelValue) {
        close();
    }
}

watch(() => props.modelValue, (visible) => {
    if (!import.meta.client) {
        return;
    }
    if (visible) {
        document.addEventListener("keydown", onKey);
    } else {
        document.removeEventListener("keydown", onKey);
    }
});

onMounted(() => {
    mounted.value = true;
});

onBeforeUnmount(() => {
    if (import.meta.client) {
        document.removeEventListener("keydown", onKey);
    }
});
</script>

<template>
    <Teleport v-if="mounted" :to="`.${LLMLINT_THEME_HOST_CLASS}`">
        <Transition name="llmlint-dialog">
            <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" @click.self="closeOnOverlay ? close() : undefined">
                <section class="flex max-h-[86vh] flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-main)] shadow-[var(--shadow-panel)]" :style="{width}">
                    <header class="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
                        <slot name="header">
                            <h2 class="min-w-0 flex-1 truncate text-base font-semibold">{{ title }}</h2>
                            <IconButton :title="t('common.close')" @click="close">
                                <span class="i-lucide-x" />
                            </IconButton>
                        </slot>
                    </header>
                    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        <slot />
                    </div>
                    <footer v-if="showFooter" class="flex justify-end gap-2 border-t border-[var(--border-color)] px-4 py-3">
                        <slot name="footer" :close="close">
                            <button class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm hover:bg-[var(--bg-hover)]" @click="close">{{ t("common.cancel") }}</button>
                            <button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-sm text-white hover:opacity-90" @click="emit('confirm')">{{ t("common.confirm") }}</button>
                        </slot>
                    </footer>
                </section>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.llmlint-dialog-enter-active,
.llmlint-dialog-leave-active {
    transition: opacity 0.18s ease;
}
.llmlint-dialog-enter-from,
.llmlint-dialog-leave-to {
    opacity: 0;
}
</style>

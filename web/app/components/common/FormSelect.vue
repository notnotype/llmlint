<script setup lang="ts">
import {computed, nextTick, ref, toRef} from "vue";
import {onClickOutside} from "@vueuse/core";
import {useLlmlintI18n} from "../../composables/useLlmlintI18n";
import {useFloatingPanelLayout, type FloatingPanelDirection} from "../../composables/useFloatingPanelLayout";

type SelectSize = "default" | "sm";

export interface SelectOption {
    value: string;
    label: string;
    description?: string;
    iconClass?: string;
    indicatorClass?: string;
}

const props = withDefaults(defineProps<{
    modelValue: string;
    options: SelectOption[];
    label?: string;
    placeholder?: string;
    /** 语义尺寸，sm 用于表格、行内编辑器这类紧凑表单。 */
    size?: SelectSize;
    dropdownDirection?: FloatingPanelDirection;
    disabled?: boolean;
    hideCheckmark?: boolean;
}>(), {
    label: "",
    placeholder: "",
    size: "default",
    dropdownDirection: "auto",
    disabled: false,
    hideCheckmark: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "focus", event: FocusEvent): void;
}>();

const {t} = useLlmlintI18n();
const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const panelRef = ref<HTMLDivElement | null>(null);
const {
    resolvedDirection,
    panelStyle,
    updateLayout,
} = useFloatingPanelLayout({
    open,
    anchorRef: rootRef,
    panelRef,
    direction: toRef(props, "dropdownDirection"),
});

onClickOutside(rootRef, () => {
    open.value = false;
});

const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
const controlSizeClass = computed(() => props.size === "sm"
    ? "h-7 px-2 text-[12px]"
    : "h-8 px-2.5 text-sm");
const optionSizeClass = computed(() => props.size === "sm"
    ? "min-h-7 px-2 py-1 text-[12px]"
    : "min-h-8 px-2.5 py-1.5 text-sm");

/**
 * 切换下拉列表。
 */
async function toggle(): Promise<void> {
    if (props.disabled) {
        return;
    }
    open.value = !open.value;
    if (open.value) {
        await nextTick();
        updateLayout();
    }
}

/**
 * 选中选项并关闭浮层。
 */
function selectOption(option: SelectOption): void {
    if (props.disabled) {
        return;
    }
    emit("update:modelValue", option.value);
    open.value = false;
}
</script>

<template>
    <div class="grid gap-1.5">
        <span v-if="props.label" class="text-xs font-medium text-[var(--text-muted)]">{{ props.label }}</span>
        <div ref="rootRef" class="relative">
            <div
                class="flex w-full items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] outline-none transition-colors select-none"
                :class="[controlSizeClass, open ? '!border-[var(--accent-main)] ring-1 ring-[var(--accent-main)]/30' : '', props.disabled ? 'cursor-default opacity-80' : 'cursor-pointer hover:bg-[var(--bg-hover)]']"
                :tabindex="props.disabled ? -1 : 0"
                :aria-disabled="props.disabled"
                @focus="emit('focus', $event)"
                @click="toggle"
            >
                <span class="flex min-w-0 items-center gap-1.5 pr-2">
                    <template v-if="selectedOption">
                        <span v-if="selectedOption.indicatorClass" class="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm" :class="selectedOption.indicatorClass"></span>
                        <span v-else-if="selectedOption.iconClass" class="h-3 w-3 shrink-0 text-[var(--text-muted)]" :class="selectedOption.iconClass"></span>
                        <span class="truncate">{{ selectedOption.label }}</span>
                    </template>
                    <span v-else class="truncate text-[var(--text-muted)] opacity-80">{{ props.placeholder || t("common.selectOption") }}</span>
                </span>
                <span class="i-lucide-chevron-down h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-200" :class="open ? '-rotate-180 text-[var(--text-main)]' : ''"></span>
            </div>

            <transition :name="resolvedDirection === 'up' ? 'dropdown-up' : 'dropdown-down'">
                <div
                    v-if="open"
                    ref="panelRef"
                    class="absolute left-0 right-0 z-[9200] overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-1.5 shadow-xl"
                    :class="resolvedDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'"
                    :style="panelStyle"
                >
                    <div
                        v-for="option in props.options"
                        :key="option.value"
                        class="mb-1 flex cursor-pointer items-center gap-2 rounded-md transition-colors last:mb-0 hover:bg-[var(--bg-hover)]"
                        :class="[optionSizeClass, option.value === props.modelValue ? 'bg-[var(--bg-input)] font-medium text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]']"
                        @click="selectOption(option)"
                    >
                        <span v-if="option.indicatorClass" class="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm" :class="option.indicatorClass"></span>
                        <span v-else-if="option.iconClass" class="h-3 w-3 shrink-0 opacity-70" :class="option.iconClass"></span>
                        <span class="min-w-0 flex-1">
                            <span class="block truncate">{{ option.label }}</span>
                            <span v-if="option.description" class="mt-0.5 block truncate text-[10px] font-normal text-[var(--text-muted)]">{{ option.description }}</span>
                        </span>
                        <span v-if="!props.hideCheckmark && option.value === props.modelValue" class="i-lucide-check ml-auto h-3 w-3 shrink-0 text-[var(--accent-main)]"></span>
                    </div>
                </div>
            </transition>
        </div>
    </div>
</template>

<style scoped>
.dropdown-down-enter-active,
.dropdown-down-leave-active,
.dropdown-up-enter-active,
.dropdown-up-leave-active {
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-down-enter-from,
.dropdown-down-leave-to {
    opacity: 0;
    transform: translateY(-4px) scaleY(0.96);
}

.dropdown-up-enter-from,
.dropdown-up-leave-to {
    opacity: 0;
    transform: translateY(4px) scaleY(0.96);
}
</style>

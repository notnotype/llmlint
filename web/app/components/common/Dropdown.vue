<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";
import {nextTick, ref} from "vue";
import type {DropdownItem} from "./dropdown.types";

const props = withDefaults(defineProps<{
    items: DropdownItem[];
    menuClass?: string;
    menuMaxHeight?: string;
    rootClass?: string;
    compact?: boolean;
}>(), {
    menuClass: "left-0 top-full mt-2 min-w-full",
    menuMaxHeight: "none",
    rootClass: "relative w-full",
    compact: false,
});

const emit = defineEmits<{
    (e: "select", value: string): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const menuId = `llmlint-dropdown-${Math.random().toString(36).slice(2)}`;

/**
 * 切换菜单显示状态。
 */
function toggle(): void {
    open.value = !open.value;
}

function close(): void {
    open.value = false;
}

/**
 * 选中菜单项并收起菜单。
 */
function select(value: string): void {
    emit("select", value);
    open.value = false;
    void nextTick(() => {
        triggerRef.value?.querySelector<HTMLElement>("button,a,[tabindex]")?.focus();
    });
}

function focusFirstItem(): void {
    void nextTick(() => {
        menuRef.value?.querySelector<HTMLButtonElement>("button")?.focus();
    });
}

function handleTriggerArrowDown(event: KeyboardEvent): void {
    event.preventDefault();
    open.value = true;
    focusFirstItem();
}

onClickOutside(rootRef, () => {
    open.value = false;
});
</script>

<template>
    <!-- 下拉菜单容器 -->
    <div ref="rootRef" :class="props.rootClass" @keydown.esc.prevent.stop="close">
        <div
            ref="triggerRef"
            class="w-full"
            :aria-expanded="open"
            :aria-controls="menuId"
            @click.stop="toggle"
            @keydown.down="handleTriggerArrowDown"
        >
            <slot />
        </div>
        <div
            v-if="open"
            :id="menuId"
            ref="menuRef"
            role="menu"
            class="absolute z-[60] overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-1 shadow-xl backdrop-blur-sm"
            :class="props.menuClass"
            :style="{maxHeight: props.menuMaxHeight}"
        >
            <button
                v-for="item in props.items"
                :key="item.value"
                type="button"
                role="menuitem"
                class="mb-1 flex w-full items-center justify-between gap-3 rounded-md px-2.5 text-left transition-colors last:mb-0"
                :class="[
                    props.compact ? 'py-1.5 text-[12px]' : 'py-1.5 text-sm',
                    item.active ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]',
                ]"
                @click.stop="select(item.value)"
            >
                <span class="inline-flex min-w-0 items-center gap-2">
                    <span v-if="item.iconClass" :class="item.iconClass" class="h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                    <span class="truncate">{{ item.label }}</span>
                </span>
                <span v-if="item.rightIconClass" :class="item.rightIconClass" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
            </button>
        </div>
    </div>
</template>

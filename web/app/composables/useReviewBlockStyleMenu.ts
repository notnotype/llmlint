import {nextTick, ref, type ComputedRef} from "vue";
import type {MarkdownFormatCommand} from "../utils/markdown-format-command";

export interface ReviewBlockStyleMenuOption {
    command: MarkdownFormatCommand;
    label: string;
    iconClass: string;
}

interface ReviewBlockStyleMenuOptions {
    menuId: string;
    options: ComputedRef<ReviewBlockStyleMenuOption[]>;
    currentOption: ComputedRef<ReviewBlockStyleMenuOption>;
    canOpen?: () => boolean;
    beforeOpen?: () => void;
    apply: (command: MarkdownFormatCommand) => void;
}

/** 统一 ReviewEditor source/preview 块样式菜单的键盘模型。 */
export function useReviewBlockStyleMenu(config: ReviewBlockStyleMenuOptions) {
    const blockStyleOpen = ref(false);
    const blockStyleTrigger = ref<HTMLButtonElement | null>(null);
    const blockStyleMenu = ref<HTMLDivElement | null>(null);
    const activeBlockStyleIndex = ref(0);

    function blockStyleItemId(index: number): string {
        return `${config.menuId}-item-${index}`;
    }

    function currentIndex(): number {
        const index = config.options.value.findIndex((option) => option.command === config.currentOption.value.command);
        return index >= 0 ? index : 0;
    }

    function focusItem(index: number): void {
        const items = blockStyleMenu.value?.querySelectorAll<HTMLElement>("[data-review-block-style-item='true']");
        items?.[index]?.focus();
    }

    function activateIndex(index: number): void {
        const length = config.options.value.length;
        if (length === 0) {
            activeBlockStyleIndex.value = 0;
            return;
        }
        activeBlockStyleIndex.value = (index + length) % length;
        nextTick(() => {
            focusItem(activeBlockStyleIndex.value);
        });
    }

    function openBlockStyle(initialIndex = currentIndex()): void {
        if (config.canOpen && !config.canOpen()) {
            return;
        }
        config.beforeOpen?.();
        blockStyleOpen.value = true;
        activateIndex(initialIndex);
    }

    function closeBlockStyle(options: {focusTrigger?: boolean} = {}): void {
        blockStyleOpen.value = false;
        if (options.focusTrigger) {
            nextTick(() => {
                blockStyleTrigger.value?.focus();
            });
        }
    }

    function toggleBlockStyle(): void {
        if (blockStyleOpen.value) {
            closeBlockStyle();
            return;
        }
        openBlockStyle();
    }

    function applyBlockStyle(command: MarkdownFormatCommand): void {
        if (config.canOpen && !config.canOpen()) {
            return;
        }
        config.apply(command);
        closeBlockStyle();
    }

    function handleBlockStyleTriggerKeydown(event: KeyboardEvent): void {
        if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const initialIndex = event.key === "ArrowUp" ? config.options.value.length - 1 : currentIndex();
        openBlockStyle(initialIndex);
    }

    function handleBlockStyleMenuKeydown(event: KeyboardEvent): void {
        if (!blockStyleOpen.value) {
            return;
        }
        if (event.key === "Tab") {
            closeBlockStyle();
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeBlockStyle({focusTrigger: true});
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            activateIndex(activeBlockStyleIndex.value + 1);
            return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            event.stopPropagation();
            activateIndex(activeBlockStyleIndex.value - 1);
            return;
        }
        if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            activateIndex(0);
            return;
        }
        if (event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            activateIndex(config.options.value.length - 1);
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            const option = config.options.value[activeBlockStyleIndex.value];
            if (option) {
                applyBlockStyle(option.command);
            }
        }
    }

    return {
        activeBlockStyleIndex,
        blockStyleItemId,
        blockStyleMenu,
        blockStyleOpen,
        blockStyleTrigger,
        applyBlockStyle,
        closeBlockStyle,
        handleBlockStyleMenuKeydown,
        handleBlockStyleTriggerKeydown,
        toggleBlockStyle,
    };
}

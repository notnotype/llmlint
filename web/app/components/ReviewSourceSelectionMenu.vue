<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import type {ReviewComment, ReviewIssueMark, ReviewTextSelection} from "../utils/review-ranges";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useNotification} from "../composables/useNotification";
import {buildSelectionOptimizationPrompt} from "../utils/llm-optimization-prompt";
import type {MarkdownFormatCommand} from "../utils/markdown-format-command";
import {markdownSelectionLinkInputHref, markdownSelectionState} from "../utils/markdown-selection-state";
import {reviewIssueActionLabel, reviewIssueLevelLabel, reviewReplacementActionLabel, reviewReplacementTitle} from "../utils/review-issue-ui";
import {useReviewBlockStyleMenu, type ReviewBlockStyleMenuOption} from "../composables/useReviewBlockStyleMenu";

const props = defineProps<{
    selection: ReviewTextSelection;
    issueMark: ReviewIssueMark | null;
    replacementMark: ReviewIssueMark | null;
    documentText: string;
    comments: ReviewComment[];
    linkRequestToken: number;
    commentRequestToken: number;
}>();

const emit = defineEmits<{
    (e: "add-comment", body: string): void;
    (e: "accept-replacement", mark: ReviewIssueMark): void;
    (e: "replace-selection", text: string): void;
    (e: "format-selection", command: MarkdownFormatCommand): void;
    (e: "link-selection", href: string): void;
}>();

const commentOpen = ref(false);
const commentBody = ref("");
const commentInput = ref<HTMLTextAreaElement | null>(null);
const linkOpen = ref(false);
const linkHref = ref("");
const linkInput = ref<HTMLInputElement | null>(null);
const copied = ref(false);
const promptCopied = ref(false);
const {t} = useLlmlintI18n();
const notification = useNotification();
const blockStyleMenuId = "llmlint-review-source-block-style-menu";

const menuStyle = computed(() => {
    const anchor = props.selection.anchor ?? {left: 24, top: 24, height: 20, containerWidth: 0, containerHeight: 0, absoluteTop: 24};
    const estimatedHeight = 44 + (props.issueMark ? 32 : 0) + (commentOpen.value ? 128 : 0) + (linkOpen.value ? 82 : 0) + (blockStyleOpen.value ? 88 : 0);
    const shouldPlaceAbove = anchor.containerHeight > 0 && anchor.top + anchor.height + estimatedHeight + 8 > anchor.containerHeight;
    const estimatedWidth = estimateMenuWidth();
    const menuWidth = anchor.containerWidth > 0 ? Math.min(estimatedWidth, Math.max(0, anchor.containerWidth - 16)) : estimatedWidth;
    const safeLeft = clampMenuCenter(anchor.left, anchor.containerWidth, menuWidth);
    return {
        width: `${menuWidth}px`,
        left: `${safeLeft}px`,
        top: shouldPlaceAbove
            ? `${Math.max(8, anchor.top - 8)}px`
            : `${Math.max(8, anchor.top + anchor.height + 8)}px`,
        transform: shouldPlaceAbove ? "translate(-50%, -100%)" : "translateX(-50%)",
    };
});
const blockStyleOptions = computed<ReviewBlockStyleMenuOption[]>(() => [
    {command: "paragraph", label: t("review.paragraphSelection"), iconClass: "i-lucide-type"},
    {command: "heading-1", label: t("review.heading1Selection"), iconClass: "i-lucide-heading-1"},
    {command: "heading-2", label: t("review.heading2Selection"), iconClass: "i-lucide-heading-2"},
    {command: "heading-3", label: t("review.heading3Selection"), iconClass: "i-lucide-heading-3"},
    {command: "bullet-list", label: t("review.bulletListSelection"), iconClass: "i-lucide-list"},
    {command: "ordered-list", label: t("review.orderedListSelection"), iconClass: "i-lucide-list-ordered"},
    {command: "blockquote", label: t("review.blockquoteSelection"), iconClass: "i-lucide-quote"},
    {command: "code-block", label: t("review.codeBlockSelection"), iconClass: "i-lucide-square-code"},
]);
const selectionState = computed(() => markdownSelectionState(props.documentText, props.selection.start, props.selection.end));
const activeBold = computed(() => selectionState.value.inline.bold);
const activeItalic = computed(() => selectionState.value.inline.italic);
const activeCode = computed(() => selectionState.value.inline.code);
const activeStrike = computed(() => selectionState.value.inline.strike);
const activeLink = computed(() => selectionState.value.inline.link);
const activeBlockquote = computed(() => selectionState.value.block.blockquote);
const activeBulletList = computed(() => selectionState.value.block.bulletList);
const activeOrderedList = computed(() => selectionState.value.block.orderedList);
const activeList = computed(() => activeBulletList.value || activeOrderedList.value);
const activeCodeBlock = computed(() => selectionState.value.block.codeBlock);
const currentBlockStyle = computed<ReviewBlockStyleMenuOption>(() => {
    const headingLevel = selectionState.value.block.headingLevel;
    if (headingLevel === 1) {
        return blockStyleOptions.value.find((option) => option.command === "heading-1") ?? blockStyleOptions.value[0]!;
    }
    if (headingLevel === 2) {
        return blockStyleOptions.value.find((option) => option.command === "heading-2") ?? blockStyleOptions.value[0]!;
    }
    if (headingLevel === 3) {
        return blockStyleOptions.value.find((option) => option.command === "heading-3") ?? blockStyleOptions.value[0]!;
    }
    if (selectionState.value.block.bulletList) {
        return blockStyleOptions.value.find((option) => option.command === "bullet-list") ?? blockStyleOptions.value[0]!;
    }
    if (selectionState.value.block.orderedList) {
        return blockStyleOptions.value.find((option) => option.command === "ordered-list") ?? blockStyleOptions.value[0]!;
    }
    if (selectionState.value.block.blockquote) {
        return blockStyleOptions.value.find((option) => option.command === "blockquote") ?? blockStyleOptions.value[0]!;
    }
    if (selectionState.value.block.codeBlock) {
        return blockStyleOptions.value.find((option) => option.command === "code-block") ?? blockStyleOptions.value[0]!;
    }
    return blockStyleOptions.value[0]!;
});
const issueLevelLabel = computed(() => reviewIssueLevelLabel(props.issueMark, t));
const issueActionLabel = computed(() => reviewIssueActionLabel(props.issueMark, t));
const {
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
} = useReviewBlockStyleMenu({
    menuId: blockStyleMenuId,
    options: blockStyleOptions,
    currentOption: currentBlockStyle,
    beforeOpen: () => {
        closeComment();
        closeLink();
    },
    apply: (command) => {
        emit("format-selection", command);
    },
});

watch(() => `${props.selection.source}:${props.selection.start}:${props.selection.end}:${props.selection.mappable}`, () => {
    copied.value = false;
    promptCopied.value = false;
    closeComment();
    closeLink();
    closeBlockStyle();
});

watch(() => props.linkRequestToken, () => {
    openLink();
});

watch(() => props.commentRequestToken, () => {
    openComment();
});

function clampMenuCenter(anchorLeft: number, containerWidth: number, estimatedWidth: number): number {
    const margin = 8;
    if (containerWidth <= margin * 2) {
        return Math.max(margin, anchorLeft);
    }
    const safeHalfWidth = Math.min(estimatedWidth / 2, Math.max(0, containerWidth / 2 - margin));
    const minLeft = margin + safeHalfWidth;
    const maxLeft = containerWidth - margin - safeHalfWidth;
    return Math.min(Math.max(anchorLeft, minLeft), Math.max(minLeft, maxLeft));
}

function estimateMenuWidth(): number {
    if (commentOpen.value || linkOpen.value || blockStyleOpen.value || props.issueMark) {
        return 390;
    }
    return props.replacementMark ? 390 : 320;
}

function replacementTitle(mark: ReviewIssueMark): string {
    return reviewReplacementTitle(mark, t);
}

function replacementActionLabel(mark: ReviewIssueMark): string {
    return reviewReplacementActionLabel(mark, t);
}

async function copySelection(): Promise<void> {
    if (!props.selection.text) {
        return;
    }
    try {
        await navigator.clipboard.writeText(props.selection.text);
        copied.value = true;
        notification.success(t("notify.selectionCopied"));
        window.setTimeout(() => {
            copied.value = false;
        }, 1200);
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

async function copyOptimizationPrompt(): Promise<void> {
    if (!props.selection.text) {
        return;
    }
    const prompt = buildSelectionOptimizationPrompt({
        selection: props.selection,
        issueMark: props.issueMark,
        replacementMark: props.replacementMark,
        text: props.documentText,
        comments: props.comments,
    });
    try {
        await navigator.clipboard.writeText(prompt);
        promptCopied.value = true;
        notification.success(t("notify.optimizationPromptCopied"));
        window.setTimeout(() => {
            promptCopied.value = false;
        }, 1200);
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

async function replaceSelectionWithClipboard(): Promise<void> {
    try {
        const clipboardText = await navigator.clipboard.readText();
        if (!clipboardText) {
            notification.info(t("notify.clipboardEmpty"));
            return;
        }
        emit("replace-selection", clipboardText);
    } catch {
        notification.error(t("notify.clipboardReadFailed"));
    }
}

function openComment(): void {
    closeLink();
    closeBlockStyle();
    commentOpen.value = true;
    nextTick(() => {
        commentInput.value?.focus();
    });
}

function submitComment(): void {
    const body = commentBody.value.trim();
    if (!body) {
        return;
    }
    emit("add-comment", body);
    commentBody.value = "";
    closeComment();
}

function closeComment(): void {
    commentOpen.value = false;
    commentBody.value = "";
}

function openLink(): void {
    closeComment();
    closeBlockStyle();
    linkOpen.value = true;
    linkHref.value = markdownSelectionLinkInputHref(props.documentText, props.selection.start, props.selection.end, props.selection.text);
    nextTick(() => {
        linkInput.value?.select();
    });
}

function submitLink(): void {
    const href = linkHref.value.trim();
    if (!href) {
        return;
    }
    emit("link-selection", href);
    closeLink();
}

function removeLink(): void {
    if (!activeLink.value) {
        return;
    }
    emit("format-selection", "remove-link");
    closeLink();
}

function closeLink(): void {
    linkOpen.value = false;
    linkHref.value = "";
}

</script>

<template>
    <div
        class="review-source-selection-menu"
        :style="menuStyle"
        :data-selection-start="selection.start"
        :data-selection-end="selection.end"
        :data-selection-text="selection.text"
        @mousedown.stop
    >
        <div v-if="issueMark" class="review-source-selection-menu__issue" :class="`is-${issueMark.level}`">
            <span class="review-source-selection-menu__level">{{ issueLevelLabel }}</span>
            <span class="review-source-selection-menu__title">{{ issueMark.title }}</span>
            <span class="review-source-selection-menu__action">{{ issueActionLabel }}</span>
        </div>
        <div class="review-source-selection-menu__toolbar" @mousedown.prevent>
            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--primary" :aria-label="t('review.addCommentTitle')" :title="t('review.addCommentTitle')" @click="openComment">
                <span class="i-lucide-message-square-plus h-3.5 w-3.5" />
                <span>{{ t("review.addComment") }}</span>
            </button>

            <div class="review-source-selection-menu__divider"></div>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :aria-label="t('review.copySelectionTitle')" :title="t('review.copySelectionTitle')" @click="void copySelection()">
                <span :class="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--primary review-source-selection-menu__button--prompt" :aria-label="t('review.copySelectionPromptTitle')" :title="t('review.copySelectionPromptTitle')" @click="void copyOptimizationPrompt()">
                <span :class="promptCopied ? 'i-lucide-check' : 'i-lucide-wand-sparkles'" class="h-3.5 w-3.5" />
                <span>{{ t("review.copySelectionPrompt") }}</span>
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :aria-label="t('review.replaceSelectionFromClipboardTitle')" :title="t('review.replaceSelectionFromClipboardTitle')" @click="void replaceSelectionWithClipboard()">
                <span class="i-lucide-clipboard-paste h-3.5 w-3.5" />
            </button>

            <div class="review-source-selection-menu__divider"></div>

            <button ref="blockStyleTrigger" type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon review-source-selection-menu__button--block-style" :class="currentBlockStyle.command !== 'paragraph' ? 'is-active' : ''" aria-haspopup="menu" :aria-controls="blockStyleMenuId" :aria-expanded="blockStyleOpen ? 'true' : 'false'" :aria-label="t('review.blockStyleTitle')" :title="t('review.blockStyleTitle')" @keydown="handleBlockStyleTriggerKeydown" @click="toggleBlockStyle">
                <span :class="currentBlockStyle.iconClass" class="h-3.5 w-3.5" />
                <span class="i-lucide-chevron-down h-2.5 w-2.5" />
            </button>

            <div class="review-source-selection-menu__divider"></div>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeBold ? 'is-active' : ''" :aria-label="t('review.boldSelectionTitle')" :title="t('review.boldSelectionTitle')" @click="emit('format-selection', 'bold')">
                <span class="i-lucide-bold h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeItalic ? 'is-active' : ''" :aria-label="t('review.italicSelectionTitle')" :title="t('review.italicSelectionTitle')" @click="emit('format-selection', 'italic')">
                <span class="i-lucide-italic h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeCode ? 'is-active' : ''" :aria-label="t('review.codeSelectionTitle')" :title="t('review.codeSelectionTitle')" @click="emit('format-selection', 'code')">
                <span class="i-lucide-code h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeStrike ? 'is-active' : ''" :aria-label="t('review.strikeSelectionTitle')" :title="t('review.strikeSelectionTitle')" @click="emit('format-selection', 'strike')">
                <span class="i-lucide-strikethrough h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeLink ? 'is-active' : ''" :aria-label="t('review.linkSelectionTitle')" :title="t('review.linkSelectionTitle')" @click="openLink">
                <span class="i-lucide-link h-3.5 w-3.5" />
            </button>

            <div class="review-source-selection-menu__divider"></div>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeBlockquote ? 'is-active' : ''" :aria-label="t('review.blockquoteSelectionTitle')" :title="t('review.blockquoteSelectionTitle')" @click="emit('format-selection', 'blockquote')">
                <span class="i-lucide-quote h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeBulletList ? 'is-active' : ''" :aria-label="t('review.bulletListSelectionTitle')" :title="t('review.bulletListSelectionTitle')" @click="emit('format-selection', 'bullet-list')">
                <span class="i-lucide-list h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeOrderedList ? 'is-active' : ''" :aria-label="t('review.orderedListSelectionTitle')" :title="t('review.orderedListSelectionTitle')" @click="emit('format-selection', 'ordered-list')">
                <span class="i-lucide-list-ordered h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :disabled="!activeList" :aria-label="activeList ? t('review.listOutdentTitle') : t('review.selectListFirstTitle')" :title="activeList ? t('review.listOutdentTitle') : t('review.selectListFirstTitle')" @click="emit('format-selection', 'list-outdent')">
                <span class="i-lucide-indent-decrease h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :disabled="!activeList" :aria-label="activeList ? t('review.listIndentTitle') : t('review.selectListFirstTitle')" :title="activeList ? t('review.listIndentTitle') : t('review.selectListFirstTitle')" @click="emit('format-selection', 'list-indent')">
                <span class="i-lucide-indent-increase h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :class="activeCodeBlock ? 'is-active' : ''" :aria-label="t('review.codeBlockSelectionTitle')" :title="t('review.codeBlockSelectionTitle')" @click="emit('format-selection', 'code-block')">
                <span class="i-lucide-square-code h-3.5 w-3.5" />
            </button>

            <button type="button" class="review-source-selection-menu__button review-source-selection-menu__button--icon" :aria-label="t('review.clearFormattingTitle')" :title="t('review.clearFormattingTitle')" @click="emit('format-selection', 'clear-formatting')">
                <span class="i-lucide-eraser h-3.5 w-3.5" />
            </button>

            <button
                v-if="replacementMark"
                type="button"
                class="review-source-selection-menu__button review-source-selection-menu__button--replace"
                :class="replacementMark.fixability === 'candidate' ? 'is-candidate' : ''"
                :aria-label="replacementTitle(replacementMark)"
                :title="replacementTitle(replacementMark)"
                @click="emit('accept-replacement', replacementMark)"
            >
                <span class="i-lucide-check h-3.5 w-3.5" />
                <span>{{ replacementActionLabel(replacementMark) }}</span>
            </button>
        </div>

        <div v-if="blockStyleOpen" :id="blockStyleMenuId" ref="blockStyleMenu" class="review-source-selection-menu__block-style" role="menu" :aria-label="t('review.blockStyleTitle')" :aria-activedescendant="blockStyleItemId(activeBlockStyleIndex)" @keydown="handleBlockStyleMenuKeydown" @mousedown.prevent>
            <button
                v-for="(option, index) in blockStyleOptions"
                :key="option.command"
                :id="blockStyleItemId(index)"
                type="button"
                data-review-block-style-item="true"
                class="review-source-selection-menu__block-style-item"
                :class="currentBlockStyle.command === option.command ? 'is-active' : ''"
                role="menuitem"
                :tabindex="activeBlockStyleIndex === index ? 0 : -1"
                :aria-label="option.label"
                :title="option.label"
                @click="applyBlockStyle(option.command)"
                @focus="activeBlockStyleIndex = index"
            >
                <span :class="option.iconClass" class="h-3.5 w-3.5" />
                <span>{{ option.label }}</span>
            </button>
        </div>

        <form v-else-if="commentOpen" data-review-source-comment-form="true" class="review-source-selection-menu__comment" @submit.prevent="submitComment">
            <textarea
                ref="commentInput"
                v-model="commentBody"
                data-review-source-comment-input="true"
                class="review-source-selection-menu__input"
                rows="3"
                :aria-label="t('review.commentBodyLabel')"
                :placeholder="t('review.writeCommentPlaceholder')"
                @keydown.esc.prevent.stop="closeComment"
                @keydown.ctrl.enter.prevent.stop="submitComment"
                @keydown.meta.enter.prevent.stop="submitComment"
            ></textarea>
            <div class="review-source-selection-menu__actions">
                <button type="button" data-review-source-comment-cancel="true" class="review-source-selection-menu__cancel" :aria-label="t('common.cancel')" :title="t('common.cancel')" @click="closeComment">{{ t("common.cancel") }}</button>
                <button type="submit" data-review-source-comment-submit="true" class="review-source-selection-menu__submit" :disabled="!commentBody.trim()" :aria-label="t('review.saveComment')" :title="t('review.saveComment')">{{ t("review.saveComment") }}</button>
            </div>
        </form>

        <form v-else-if="linkOpen" data-review-source-link-form="true" class="review-source-selection-menu__link" @submit.prevent="submitLink">
            <input
                ref="linkInput"
                v-model="linkHref"
                data-review-source-link-input="true"
                class="review-source-selection-menu__link-input"
                :aria-label="t('review.linkUrlPlaceholder')"
                :placeholder="t('review.linkUrlPlaceholder')"
                @keydown.esc.prevent.stop="closeLink"
                @keydown.ctrl.enter.prevent.stop="submitLink"
                @keydown.meta.enter.prevent.stop="submitLink"
            />
            <div class="review-source-selection-menu__actions">
                <button v-if="activeLink" type="button" data-review-source-link-remove="true" class="review-source-selection-menu__cancel review-source-selection-menu__cancel--danger" :aria-label="t('review.removeLink')" :title="t('review.removeLink')" @click="removeLink">{{ t("review.removeLink") }}</button>
                <button type="button" data-review-source-link-cancel="true" class="review-source-selection-menu__cancel" :aria-label="t('common.cancel')" :title="t('common.cancel')" @click="closeLink">{{ t("common.cancel") }}</button>
                <button type="submit" data-review-source-link-submit="true" class="review-source-selection-menu__submit" :disabled="!linkHref.trim()" :aria-label="t('review.applyLink')" :title="t('review.applyLink')">{{ t("review.applyLink") }}</button>
            </div>
        </form>
    </div>
</template>

<style scoped>
.review-source-selection-menu {
    position: absolute;
    z-index: 30;
    overflow: hidden;
    width: max-content;
    max-width: calc(100% - 16px);
    border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
    border-radius: 18px;
    background: color-mix(in srgb, var(--bg-panel) 96%, var(--bg-input));
    color: var(--text-main);
    box-shadow: 0 18px 44px color-mix(in srgb, #000 16%, transparent), 0 1px 2px color-mix(in srgb, #000 14%, transparent);
}

.review-source-selection-menu__toolbar {
    display: flex;
    max-width: 100%;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px;
}

.review-source-selection-menu__issue {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    width: 100%;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid var(--border-color);
    padding: 7px 9px 6px;
    color: var(--text-secondary);
    font-size: 12px;
}

.review-source-selection-menu__level {
    display: inline-flex;
    height: 18px;
    min-width: 18px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--bg-subtle);
    font-size: 10px;
    font-weight: 750;
}

.review-source-selection-menu__issue.is-high .review-source-selection-menu__level {
    background: rgba(248, 113, 113, 0.18);
    color: rgb(220, 38, 38);
}

.review-source-selection-menu__issue.is-medium .review-source-selection-menu__level {
    background: rgba(245, 158, 11, 0.18);
    color: rgb(217, 119, 6);
}

.review-source-selection-menu__issue.is-low .review-source-selection-menu__level {
    background: color-mix(in srgb, var(--text-muted) 14%, var(--bg-subtle));
    color: var(--text-muted);
}

.review-source-selection-menu__title {
    min-width: 0;
    overflow: hidden;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.review-source-selection-menu__action {
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
}

.review-source-selection-menu__button {
    display: inline-flex;
    height: 30px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 10px;
    padding: 0 9px;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.review-source-selection-menu__button:hover,
.review-source-selection-menu__button.is-active {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-source-selection-menu__button:disabled {
    cursor: default;
    opacity: 0.45;
}

.review-source-selection-menu__button:disabled:hover {
    background: transparent;
    color: var(--text-secondary);
}

.review-source-selection-menu__button--primary,
.review-source-selection-menu__button--replace {
    font-weight: 650;
}

.review-source-selection-menu__button--replace {
    color: rgb(5, 150, 105);
}

.review-source-selection-menu__button--replace.is-candidate {
    color: rgb(180, 83, 9);
}

.review-source-selection-menu__button--prompt {
    background: color-mix(in srgb, var(--accent-main) 10%, transparent);
    color: var(--accent-text);
}

.review-source-selection-menu__button--prompt:hover {
    background: color-mix(in srgb, var(--accent-main) 16%, transparent);
    color: var(--accent-text);
}

.review-source-selection-menu__button--icon {
    width: 30px;
    padding: 0;
}

.review-source-selection-menu__button--block-style {
    width: 38px;
    gap: 3px;
}

.review-source-selection-menu__divider {
    width: 1px;
    height: 24px;
    margin: 0 4px;
    background: color-mix(in srgb, var(--border-color) 72%, transparent);
}

.review-source-selection-menu__comment {
    display: grid;
    width: min(320px, calc(100vw - 32px));
    gap: 7px;
    border-top: 1px solid var(--border-color);
    padding: 7px;
}

.review-source-selection-menu__link {
    display: grid;
    width: min(320px, calc(100vw - 32px));
    gap: 7px;
    border-top: 1px solid var(--border-color);
    padding: 7px;
}

.review-source-selection-menu__block-style {
    display: grid;
    width: min(320px, calc(100vw - 32px));
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    border-top: 1px solid var(--border-color);
    padding: 7px;
}

.review-source-selection-menu__block-style-item {
    display: inline-flex;
    height: 30px;
    min-width: 0;
    align-items: center;
    justify-content: flex-start;
    gap: 7px;
    border-radius: 9px;
    padding: 0 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 650;
}

.review-source-selection-menu__block-style-item:hover,
.review-source-selection-menu__block-style-item.is-active {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-source-selection-menu__input {
    width: 100%;
    min-height: 72px;
    resize: vertical;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-input);
    padding: 7px 8px;
    color: var(--text-main);
    font-size: 13px;
    line-height: 1.45;
    outline: none;
}

.review-source-selection-menu__link-input {
    width: 100%;
    height: 34px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-input);
    padding: 0 9px;
    color: var(--text-main);
    font-size: 13px;
    outline: none;
}

.review-source-selection-menu__link-input:focus {
    border-color: var(--accent-main);
}

.review-source-selection-menu__input:focus {
    border-color: var(--accent-main);
}

.review-source-selection-menu__actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
}

.review-source-selection-menu__cancel,
.review-source-selection-menu__submit {
    min-width: 52px;
    height: 28px;
    border-radius: 10px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 650;
}

.review-source-selection-menu__cancel {
    color: var(--text-muted);
}

.review-source-selection-menu__cancel:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-source-selection-menu__cancel--danger:hover {
    background: color-mix(in srgb, #ef4444 10%, transparent);
    color: #dc2626;
}

.review-source-selection-menu__submit {
    background: var(--accent-main);
    color: #fff;
}

.review-source-selection-menu__submit:disabled {
    opacity: 0.5;
}
</style>

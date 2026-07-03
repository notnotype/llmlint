<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import type {Editor} from "@tiptap/core";
import {BubbleMenu} from "@tiptap/vue-3/menus";
import type {EditorState} from "@tiptap/pm/state";
import type {EditorView} from "@tiptap/pm/view";
import type {ReviewComment, ReviewIssueMark, ReviewTextSelection} from "../utils/review-ranges";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useNotification} from "../composables/useNotification";
import {buildSelectionOptimizationPrompt} from "../utils/llm-optimization-prompt";
import type {MarkdownFormatCommand} from "../utils/markdown-format-command";
import {markdownSelectionLinkInputHref, markdownSelectionState} from "../utils/markdown-selection-state";
import {reviewIssueActionLabel, reviewIssueLevelLabel, reviewReplacementActionLabel, reviewReplacementTitle} from "../utils/review-issue-ui";
import {useReviewBlockStyleMenu, type ReviewBlockStyleMenuOption} from "../composables/useReviewBlockStyleMenu";

const props = defineProps<{
    editor: Editor;
    selection: ReviewTextSelection | null;
    issueMark: ReviewIssueMark | null;
    replacementMark: ReviewIssueMark | null;
    documentText: string;
    comments: ReviewComment[];
    linkRequestToken: number;
    commentRequestToken: number;
}>();

const emit = defineEmits<{
    (e: "add-comment", body: string): void;
    (e: "locate-source"): void;
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
const blockStyleMenuId = "llmlint-review-preview-block-style-menu";

const bubbleOptions = {
    strategy: "fixed" as const,
    placement: "bottom" as const,
    offset: 10,
    shift: {padding: 10},
    flip: {padding: 10},
    inline: true,
};

const canUseSelection = computed(() => Boolean(props.selection?.mappable));
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
const selectionState = computed(() => props.selection?.mappable
    ? markdownSelectionState(props.documentText, props.selection.start, props.selection.end)
    : null);
const activeBold = computed(() => selectionState.value?.inline.bold ?? false);
const activeItalic = computed(() => selectionState.value?.inline.italic ?? false);
const activeCode = computed(() => selectionState.value?.inline.code ?? false);
const activeStrike = computed(() => selectionState.value?.inline.strike ?? false);
const activeLink = computed(() => selectionState.value?.inline.link ?? false);
const activeBlockquote = computed(() => selectionState.value?.block.blockquote ?? false);
const activeBulletList = computed(() => selectionState.value?.block.bulletList ?? false);
const activeOrderedList = computed(() => selectionState.value?.block.orderedList ?? false);
const activeList = computed(() => activeBulletList.value || activeOrderedList.value);
const activeCodeBlock = computed(() => selectionState.value?.block.codeBlock ?? false);
const currentBlockStyle = computed<ReviewBlockStyleMenuOption>(() => {
    const headingLevel = selectionState.value?.block.headingLevel ?? null;
    if (headingLevel === 1) {
        return blockStyleOptions.value.find((option) => option.command === "heading-1") ?? blockStyleOptions.value[0]!;
    }
    if (headingLevel === 2) {
        return blockStyleOptions.value.find((option) => option.command === "heading-2") ?? blockStyleOptions.value[0]!;
    }
    if (headingLevel === 3) {
        return blockStyleOptions.value.find((option) => option.command === "heading-3") ?? blockStyleOptions.value[0]!;
    }
    if (selectionState.value?.block.bulletList) {
        return blockStyleOptions.value.find((option) => option.command === "bullet-list") ?? blockStyleOptions.value[0]!;
    }
    if (selectionState.value?.block.orderedList) {
        return blockStyleOptions.value.find((option) => option.command === "ordered-list") ?? blockStyleOptions.value[0]!;
    }
    if (selectionState.value?.block.blockquote) {
        return blockStyleOptions.value.find((option) => option.command === "blockquote") ?? blockStyleOptions.value[0]!;
    }
    if (selectionState.value?.block.codeBlock) {
        return blockStyleOptions.value.find((option) => option.command === "code-block") ?? blockStyleOptions.value[0]!;
    }
    return blockStyleOptions.value[0]!;
});
const commentDisabledTitle = computed(() => props.selection?.disabledReason ?? t("review.selectTextFirst"));
const listOutdentTitle = computed(() => {
    if (!canUseSelection.value) {
        return commentDisabledTitle.value;
    }
    return activeList.value ? t("review.listOutdentTitle") : t("review.selectListFirstTitle");
});
const listIndentTitle = computed(() => {
    if (!canUseSelection.value) {
        return commentDisabledTitle.value;
    }
    return activeList.value ? t("review.listIndentTitle") : t("review.selectListFirstTitle");
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
    canOpen: () => canUseSelection.value,
    beforeOpen: () => {
        closeComment();
        closeLink();
    },
    apply: (command) => {
        emit("format-selection", command);
    },
});

watch(() => props.selection
    ? `${props.selection.source}:${props.selection.start}:${props.selection.end}:${props.selection.mappable}`
    : "",
() => {
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

function replacementTitle(mark: ReviewIssueMark): string {
    return reviewReplacementTitle(mark, t);
}

function replacementActionLabel(mark: ReviewIssueMark): string {
    return reviewReplacementActionLabel(mark, t);
}

function appendToThemeHost(): HTMLElement {
    return document.querySelector<HTMLElement>(".llmlint-theme") ?? document.body;
}

function shouldShowMenu(options: {
    editor: Editor;
    view: EditorView;
    state: EditorState;
    from: number;
    to: number;
}): boolean {
    if (options.from === options.to || options.state.selection.empty) {
        closeComment();
        closeLink();
        closeBlockStyle();
        return false;
    }
    return Boolean(options.view.dom.closest(".llmlint-review-editor"));
}

async function copySelection(): Promise<void> {
    const text = props.selection?.text ?? "";
    if (!text) {
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
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
    if (!props.selection?.text) {
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
    if (!canUseSelection.value) {
        return;
    }
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
    if (!canUseSelection.value) {
        return;
    }
    closeLink();
    closeBlockStyle();
    commentOpen.value = true;
    nextTick(() => {
        commentInput.value?.focus();
    });
}

function submitComment(): void {
    const body = commentBody.value.trim();
    if (!body || !canUseSelection.value) {
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
    const selection = props.selection;
    if (!selection?.mappable) {
        return;
    }
    closeComment();
    closeBlockStyle();
    linkOpen.value = true;
    linkHref.value = markdownSelectionLinkInputHref(props.documentText, selection.start, selection.end, selection.text);
    nextTick(() => {
        linkInput.value?.select();
    });
}

function submitLink(): void {
    const href = linkHref.value.trim();
    if (!href || !canUseSelection.value) {
        return;
    }
    emit("link-selection", href);
    closeLink();
}

function removeLink(): void {
    if (!canUseSelection.value || !activeLink.value) {
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
    <BubbleMenu
        class="review-selection-menu-layer"
        :editor="props.editor"
        plugin-key="llmlint-review-selection-menu"
        :append-to="appendToThemeHost"
        :should-show="shouldShowMenu"
        :options="bubbleOptions"
        :update-delay="80"
        :resize-delay="80"
    >
        <div
            class="review-selection-menu"
            :data-selection-start="selection?.start ?? ''"
            :data-selection-end="selection?.end ?? ''"
            :data-selection-text="selection?.text ?? ''"
        >
            <div v-if="issueMark" class="review-selection-menu__issue" :class="`is-${issueMark.level}`">
                <span class="review-selection-menu__level">{{ issueLevelLabel }}</span>
                <span class="review-selection-menu__title">{{ issueMark.title }}</span>
                <span class="review-selection-menu__action">{{ issueActionLabel }}</span>
            </div>
            <div class="review-selection-menu__toolbar">
                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--primary"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.addCommentTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.addCommentTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="openComment"
                >
                    <span class="i-lucide-message-square-plus h-3.5 w-3.5" />
                    <span>{{ t("review.addComment") }}</span>
                </button>

                <div class="review-selection-menu__divider"></div>

                <button
                    ref="blockStyleTrigger"
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon review-selection-menu__button--block-style"
                    :class="currentBlockStyle.command !== 'paragraph' ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    aria-haspopup="menu"
                    :aria-controls="blockStyleMenuId"
                    :aria-expanded="blockStyleOpen ? 'true' : 'false'"
                    :aria-label="canUseSelection ? t('review.blockStyleTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.blockStyleTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @keydown="handleBlockStyleTriggerKeydown"
                    @click="toggleBlockStyle"
                >
                    <span :class="currentBlockStyle.iconClass" class="h-3.5 w-3.5" />
                    <span class="i-lucide-chevron-down h-2.5 w-2.5" />
                </button>

                <div class="review-selection-menu__divider"></div>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :aria-label="t('review.copySelectionTitle')"
                    :title="t('review.copySelectionTitle')"
                    @mousedown.prevent
                    @click="void copySelection()"
                >
                    <span :class="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--primary review-selection-menu__button--prompt"
                    :aria-label="t('review.copySelectionPromptTitle')"
                    :title="t('review.copySelectionPromptTitle')"
                    @mousedown.prevent
                    @click="void copyOptimizationPrompt()"
                >
                    <span :class="promptCopied ? 'i-lucide-check' : 'i-lucide-wand-sparkles'" class="h-3.5 w-3.5" />
                    <span>{{ t("review.copySelectionPrompt") }}</span>
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.replaceSelectionFromClipboardTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.replaceSelectionFromClipboardTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="void replaceSelectionWithClipboard()"
                >
                    <span class="i-lucide-clipboard-paste h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.locateSourceTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.locateSourceTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('locate-source')"
                >
                    <span class="i-lucide-file-search h-3.5 w-3.5" />
                </button>

                <div class="review-selection-menu__divider"></div>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeBold ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.boldSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.boldSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'bold')"
                >
                    <span class="i-lucide-bold h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeItalic ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.italicSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.italicSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'italic')"
                >
                    <span class="i-lucide-italic h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeCode ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.codeSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.codeSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'code')"
                >
                    <span class="i-lucide-code h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeStrike ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.strikeSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.strikeSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'strike')"
                >
                    <span class="i-lucide-strikethrough h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeLink ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.linkSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.linkSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="openLink"
                >
                    <span class="i-lucide-link h-3.5 w-3.5" />
                </button>

                <div class="review-selection-menu__divider"></div>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeBlockquote ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.blockquoteSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.blockquoteSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'blockquote')"
                >
                    <span class="i-lucide-quote h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeBulletList ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.bulletListSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.bulletListSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'bullet-list')"
                >
                    <span class="i-lucide-list h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeOrderedList ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.orderedListSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.orderedListSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'ordered-list')"
                >
                    <span class="i-lucide-list-ordered h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :disabled="!canUseSelection || !activeList"
                    :aria-label="listOutdentTitle"
                    :title="listOutdentTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'list-outdent')"
                >
                    <span class="i-lucide-indent-decrease h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :disabled="!canUseSelection || !activeList"
                    :aria-label="listIndentTitle"
                    :title="listIndentTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'list-indent')"
                >
                    <span class="i-lucide-indent-increase h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :class="activeCodeBlock ? 'is-active' : ''"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.codeBlockSelectionTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.codeBlockSelectionTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'code-block')"
                >
                    <span class="i-lucide-square-code h-3.5 w-3.5" />
                </button>

                <button
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--icon"
                    :disabled="!canUseSelection"
                    :aria-label="canUseSelection ? t('review.clearFormattingTitle') : commentDisabledTitle"
                    :title="canUseSelection ? t('review.clearFormattingTitle') : commentDisabledTitle"
                    @mousedown.prevent
                    @click="emit('format-selection', 'clear-formatting')"
                >
                    <span class="i-lucide-eraser h-3.5 w-3.5" />
                </button>

                <button
                    v-if="replacementMark"
                    type="button"
                    class="review-selection-menu__button review-selection-menu__button--replace"
                    :class="replacementMark.fixability === 'candidate' ? 'is-candidate' : ''"
                    :aria-label="replacementTitle(replacementMark)"
                    :title="replacementTitle(replacementMark)"
                    @mousedown.prevent
                    @click="emit('accept-replacement', replacementMark)"
                >
                    <span class="i-lucide-check h-3.5 w-3.5" />
                    <span>{{ replacementActionLabel(replacementMark) }}</span>
                </button>
            </div>

            <div v-if="blockStyleOpen" :id="blockStyleMenuId" ref="blockStyleMenu" class="review-selection-menu__block-style" role="menu" :aria-label="t('review.blockStyleTitle')" :aria-activedescendant="blockStyleItemId(activeBlockStyleIndex)" @keydown="handleBlockStyleMenuKeydown">
                <button
                    v-for="(option, index) in blockStyleOptions"
                    :key="option.command"
                    :id="blockStyleItemId(index)"
                    type="button"
                    data-review-block-style-item="true"
                    class="review-selection-menu__block-style-item"
                    :class="currentBlockStyle.command === option.command ? 'is-active' : ''"
                    role="menuitem"
                    :tabindex="activeBlockStyleIndex === index ? 0 : -1"
                    :aria-label="option.label"
                    :title="option.label"
                    @mousedown.prevent
                    @click="applyBlockStyle(option.command)"
                    @focus="activeBlockStyleIndex = index"
                >
                    <span :class="option.iconClass" class="h-3.5 w-3.5" />
                    <span>{{ option.label }}</span>
                </button>
            </div>

            <form v-else-if="commentOpen" data-review-comment-form="true" class="review-selection-menu__comment" @submit.prevent="submitComment">
                <textarea
                    ref="commentInput"
                    v-model="commentBody"
                    data-review-comment-input="true"
                    class="review-selection-menu__input"
                    rows="3"
                    :aria-label="t('review.commentBodyLabel')"
                    :placeholder="t('review.writeCommentPlaceholder')"
                    @keydown.esc.prevent.stop="closeComment"
                    @keydown.ctrl.enter.prevent.stop="submitComment"
                    @keydown.meta.enter.prevent.stop="submitComment"
                ></textarea>
                <div class="review-selection-menu__actions">
                    <button type="button" data-review-comment-cancel="true" class="review-selection-menu__cancel" :aria-label="t('common.cancel')" :title="t('common.cancel')" @click="closeComment">{{ t("common.cancel") }}</button>
                    <button type="submit" data-review-comment-submit="true" class="review-selection-menu__submit" :disabled="!commentBody.trim()" :aria-label="t('review.saveComment')" :title="t('review.saveComment')">{{ t("review.saveComment") }}</button>
                </div>
            </form>

            <form v-else-if="linkOpen" data-review-link-form="true" class="review-selection-menu__link" @submit.prevent="submitLink">
                <input
                    ref="linkInput"
                    v-model="linkHref"
                    data-review-link-input="true"
                    class="review-selection-menu__link-input"
                    :aria-label="t('review.linkUrlPlaceholder')"
                    :placeholder="t('review.linkUrlPlaceholder')"
                    @keydown.esc.prevent.stop="closeLink"
                    @keydown.ctrl.enter.prevent.stop="submitLink"
                    @keydown.meta.enter.prevent.stop="submitLink"
                />
                <div class="review-selection-menu__actions">
                    <button v-if="activeLink" type="button" data-review-link-remove="true" class="review-selection-menu__cancel review-selection-menu__cancel--danger" :aria-label="t('review.removeLink')" :title="t('review.removeLink')" @click="removeLink">{{ t("review.removeLink") }}</button>
                    <button type="button" data-review-link-cancel="true" class="review-selection-menu__cancel" :aria-label="t('common.cancel')" :title="t('common.cancel')" @click="closeLink">{{ t("common.cancel") }}</button>
                    <button type="submit" data-review-link-submit="true" class="review-selection-menu__submit" :disabled="!linkHref.trim()" :aria-label="t('review.applyLink')" :title="t('review.applyLink')">{{ t("review.applyLink") }}</button>
                </div>
            </form>

            <div v-else-if="selection && !selection.mappable" class="review-selection-menu__hint">
                {{ selection.disabledReason }}
            </div>
        </div>
    </BubbleMenu>
</template>

<style scoped>
.review-selection-menu-layer {
    z-index: 8600;
    pointer-events: auto;
}

.review-selection-menu {
    overflow: hidden;
    width: max-content;
    max-width: min(520px, calc(100vw - 20px));
    border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
    border-radius: 18px;
    background: color-mix(in srgb, var(--bg-panel) 96%, var(--bg-input));
    color: var(--text-main);
    box-shadow: 0 18px 44px color-mix(in srgb, #000 16%, transparent), 0 1px 2px color-mix(in srgb, #000 14%, transparent);
}

.review-selection-menu__toolbar {
    display: flex;
    max-width: 100%;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px;
}

.review-selection-menu__issue {
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

.review-selection-menu__level {
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

.review-selection-menu__issue.is-high .review-selection-menu__level {
    background: rgba(248, 113, 113, 0.18);
    color: rgb(220, 38, 38);
}

.review-selection-menu__issue.is-medium .review-selection-menu__level {
    background: rgba(245, 158, 11, 0.18);
    color: rgb(217, 119, 6);
}

.review-selection-menu__issue.is-low .review-selection-menu__level {
    background: color-mix(in srgb, var(--text-muted) 14%, var(--bg-subtle));
    color: var(--text-muted);
}

.review-selection-menu__title {
    min-width: 0;
    overflow: hidden;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.review-selection-menu__action {
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
}

.review-selection-menu__button {
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

.review-selection-menu__button:hover,
.review-selection-menu__button.is-active {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-selection-menu__button:disabled {
    cursor: default;
    opacity: 0.45;
}

.review-selection-menu__button:disabled:hover {
    background: transparent;
    color: var(--text-secondary);
}

.review-selection-menu__button--primary,
.review-selection-menu__button--replace {
    font-weight: 650;
}

.review-selection-menu__button--replace {
    color: rgb(5, 150, 105);
}

.review-selection-menu__button--replace.is-candidate {
    color: rgb(180, 83, 9);
}

.review-selection-menu__button--prompt {
    background: color-mix(in srgb, var(--accent-main) 10%, transparent);
    color: var(--accent-text);
}

.review-selection-menu__button--prompt:hover {
    background: color-mix(in srgb, var(--accent-main) 16%, transparent);
    color: var(--accent-text);
}

.review-selection-menu__button--icon {
    width: 30px;
    padding: 0;
}

.review-selection-menu__button--block-style {
    width: 38px;
    gap: 3px;
}

.review-selection-menu__divider {
    width: 1px;
    height: 24px;
    margin: 0 4px;
    background: color-mix(in srgb, var(--border-color) 72%, transparent);
}

.review-selection-menu__comment {
    display: grid;
    width: min(320px, calc(100vw - 32px));
    gap: 7px;
    border-top: 1px solid var(--border-color);
    padding: 7px;
}

.review-selection-menu__link {
    display: grid;
    width: min(320px, calc(100vw - 32px));
    gap: 7px;
    border-top: 1px solid var(--border-color);
    padding: 7px;
}

.review-selection-menu__block-style {
    display: grid;
    width: min(320px, calc(100vw - 32px));
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    border-top: 1px solid var(--border-color);
    padding: 7px;
}

.review-selection-menu__block-style-item {
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

.review-selection-menu__block-style-item:hover,
.review-selection-menu__block-style-item.is-active {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-selection-menu__input {
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

.review-selection-menu__link-input {
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

.review-selection-menu__link-input:focus {
    border-color: var(--accent-main);
}

.review-selection-menu__input:focus {
    border-color: var(--accent-main);
}

.review-selection-menu__actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
}

.review-selection-menu__cancel,
.review-selection-menu__submit {
    min-width: 52px;
    height: 28px;
    border-radius: 10px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 650;
}

.review-selection-menu__cancel {
    color: var(--text-muted);
}

.review-selection-menu__cancel:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-selection-menu__cancel--danger:hover {
    background: color-mix(in srgb, #ef4444 10%, transparent);
    color: #dc2626;
}

.review-selection-menu__submit {
    background: var(--accent-main);
    color: #fff;
}

.review-selection-menu__submit:disabled {
    opacity: 0.5;
}

.review-selection-menu__hint {
    max-width: 280px;
    border-top: 1px solid var(--border-color);
    padding: 7px 10px 8px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.5;
}
</style>

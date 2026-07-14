<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {computePosition, flip, offset, shift} from "@floating-ui/dom";
import type {ReviewIssueMark} from "../utils/review-ranges";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {reviewReplacementActionLabel, reviewReplacementTitle} from "../utils/review-issue-ui";
import {verdictBadge} from "../utils/verdict-badge";

// inline 规则菜单（Task 16 R2）：点击编辑器里的命中高亮 / 校对符号后弹出——展示规则标题、ID、
// 说明与 verdict 徽标，并提供「应用替换」「隐藏此规则」两个动作。定位用 @floating-ui/dom
// 锚到被点击的 DOM 节点；Esc / 点击菜单外 / 任意滚动时由本组件自行 emit close。
// Task 17 A2：源码模式没有可锚 DOM 节点，anchor 放宽为 floating-ui 虚拟锚点（getBoundingClientRect）。

/** floating-ui 虚拟锚点：源码模式用镜像法算出的光标矩形合成（无真实 DOM 节点可锚）。 */
type RuleInlineMenuAnchor = HTMLElement | {getBoundingClientRect: () => DOMRect};

const props = defineProps<{
    /** 被点击命中的 mark 数据（含可选 note / verdict）。 */
    mark: ReviewIssueMark;
    /** 锚元素：被点击的命中高亮 span / 校对符号节点，或源码模式的虚拟光标锚点。 */
    anchor: RuleInlineMenuAnchor;
}>();

const emit = defineEmits<{
    (e: "apply", mark: ReviewIssueMark): void;
    (e: "hide", ruleId: string): void;
    (e: "close"): void;
}>();

const {t} = useLlmlintI18n();
const menuRef = ref<HTMLElement | null>(null);
// 初始藏到屏幕外，computePosition 完成后再落位（避免闪现在左上角）。
const menuPosition = ref<{left: number; top: number}>({left: -9999, top: -9999});
// Teleport 到主题宿主（与 ReviewSelectionMenu 的 appendToThemeHost 同口径）：
// 主题 CSS 变量挂在 .llmlint-theme 元素上，直接挂 body 会丢主题变量。
// 本组件只在点击后客户端渲染，setup 时 document 必在。
const teleportTarget = document.querySelector<HTMLElement>(".llmlint-theme") ?? document.body;

// verdict 徽标（W0 单源）：未测 / 空值也显示「未测」。
const badge = computed(() => verdictBadge(props.mark.verdict));
const applyLabel = computed(() => reviewReplacementActionLabel(props.mark, t, {applyPrefix: true}));
const applyTitle = computed(() => reviewReplacementTitle(props.mark, t));

/** 用 floating-ui 把菜单定位到锚元素下方（翻转 + 平移防出屏）。虚拟锚点无 isConnected，仅真实节点判断脱挂。 */
async function updatePosition(): Promise<void> {
    const menu = menuRef.value;
    if (!menu || (props.anchor instanceof HTMLElement && !props.anchor.isConnected)) {
        return;
    }
    const {x, y} = await computePosition(props.anchor, menu, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(8), flip({padding: 10}), shift({padding: 10})],
    });
    menuPosition.value = {left: x, top: y};
}

// 换 mark / 换锚元素时重新定位（菜单保持打开，内容随 props 响应式更新）。
watch(() => [props.mark.id, props.anchor] as const, () => {
    void nextTick(() => void updatePosition());
});

/** 点击菜单外任意处关闭（capture 抢在编辑器 click 处理之前判定归属）。 */
function handleDocumentPointerDown(event: PointerEvent): void {
    const target = event.target instanceof Node ? event.target : null;
    if (target && menuRef.value?.contains(target)) {
        return;
    }
    emit("close");
}

/** Esc 关闭。 */
function handleDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
        event.preventDefault();
        emit("close");
    }
}

/** 任意滚动（含编辑器容器内滚动，capture 捕获）关闭——锚点会漂移，不追随。 */
function handleDocumentScroll(event: Event): void {
    const target = event.target instanceof Node ? event.target : null;
    if (target && menuRef.value?.contains(target)) {
        return;
    }
    emit("close");
}

onMounted(() => {
    void nextTick(() => void updatePosition());
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("scroll", handleDocumentScroll, true);
});

onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    document.removeEventListener("keydown", handleDocumentKeyDown, true);
    document.removeEventListener("scroll", handleDocumentScroll, true);
});
</script>

<template>
    <!-- Teleport 到主题宿主：脱离编辑器 overflow 裁剪；z-index 与 ReviewSelectionMenu 同层（8600） -->
    <Teleport :to="teleportTarget">
        <div
            ref="menuRef"
            class="rule-inline-menu"
            role="dialog"
            :aria-label="mark.title"
            :style="{left: `${menuPosition.left}px`, top: `${menuPosition.top}px`}"
        >
            <!-- 规则头：标题 + ID 小字 + verdict 徽标 -->
            <div class="rule-inline-menu__header">
                <div class="rule-inline-menu__heading">
                    <span class="rule-inline-menu__title">{{ mark.title }}</span>
                    <span class="rule-inline-menu__id">{{ mark.ruleId }}</span>
                </div>
                <span class="rule-inline-menu__badge" :class="badge.cls">{{ t(badge.labelKey) }}</span>
            </div>
            <!-- 规则说明（有才显示） -->
            <p v-if="mark.note" class="rule-inline-menu__note">{{ mark.note }}</p>
            <!-- 动作区：应用替换（仅可自动替换命中） + 隐藏此规则 -->
            <div class="rule-inline-menu__actions">
                <button
                    v-if="mark.replacement !== null"
                    type="button"
                    class="rule-inline-menu__apply"
                    :aria-label="applyTitle"
                    :title="applyTitle"
                    @click="emit('apply', mark)"
                >
                    <span class="i-lucide-check h-3.5 w-3.5" />
                    <span>{{ applyLabel }}</span>
                </button>
                <button
                    type="button"
                    class="rule-inline-menu__hide"
                    :aria-label="t('review.ruleMenuHide')"
                    :title="t('review.ruleMenuHide')"
                    @click="emit('hide', mark.ruleId)"
                >
                    <span class="i-lucide-eye-off h-3.5 w-3.5" />
                    <span>{{ t("review.ruleMenuHide") }}</span>
                </button>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/* 外观口径抄 ReviewSelectionMenu：同 z-index 层、同底色 / 圆角 / 阴影体系 */
.rule-inline-menu {
    position: fixed;
    z-index: 8600;
    display: grid;
    width: max-content;
    max-width: min(360px, calc(100vw - 20px));
    gap: 6px;
    border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-panel) 96%, var(--bg-input));
    padding: 9px 10px;
    color: var(--text-main);
    box-shadow: 0 18px 44px color-mix(in srgb, #000 16%, transparent), 0 1px 2px color-mix(in srgb, #000 14%, transparent);
}

.rule-inline-menu__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
}

.rule-inline-menu__heading {
    display: grid;
    min-width: 0;
    gap: 2px;
}

.rule-inline-menu__title {
    font-size: 13px;
    font-weight: 650;
    line-height: 1.35;
}

.rule-inline-menu__id {
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    word-break: break-all;
}

.rule-inline-menu__badge {
    display: inline-flex;
    height: 18px;
    flex: 0 0 auto;
    align-items: center;
    border-radius: 999px;
    padding: 0 7px;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
}

.rule-inline-menu__note {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
}

.rule-inline-menu__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding-top: 2px;
}

.rule-inline-menu__apply,
.rule-inline-menu__hide {
    display: inline-flex;
    height: 28px;
    align-items: center;
    gap: 5px;
    border-radius: 9px;
    padding: 0 9px;
    font-size: 12px;
    font-weight: 650;
    line-height: 1;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.rule-inline-menu__apply {
    background: color-mix(in srgb, #10b981 12%, transparent);
    color: rgb(5, 150, 105);
}

.rule-inline-menu__apply:hover {
    background: color-mix(in srgb, #10b981 20%, transparent);
}

.rule-inline-menu__hide {
    color: var(--text-muted);
}

.rule-inline-menu__hide:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}
</style>

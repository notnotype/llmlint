<script setup lang="ts">
import {computed, reactive, ref} from "vue";
import {useLlmlint} from "../composables/useLlmlint";
import {useNotification} from "../composables/useNotification";
import {useWebSettings} from "../composables/useWebSettings";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {resolveApiErrorMessage} from "../utils/api-error";
import type {Issue, RegexRuleRecord, RuleGroup, UiFilters} from "../types";
import FormSelect, {type SelectOption} from "../components/common/FormSelect.vue";
import SwitchField from "../components/common/SwitchField.vue";

type Provenance = "human" | "ai" | "mixed" | "unknown";
type Visibility = "private" | "public";
type SubmitStep = "draft" | "report";

const {registry, scan, applyFilters, summarize, groupByRule, issueRanges, offsetOf, issueAtOffset, namespaceOptions} = useLlmlint();
const {settings, patch} = useWebSettings();
const {t} = useLlmlintI18n();
const notification = useNotification();

const provenanceOptions = computed<SelectOption[]>(() => [
    {value: "unknown", label: t("contribute.unknown")},
    {value: "human", label: t("contribute.humanWriting")},
    {value: "ai", label: t("contribute.aiGenerated")},
    {value: "mixed", label: t("contribute.mixedWriting")},
]);

const visibilityOptions = computed<SelectOption[]>(() => [
    {value: "private", label: t("contribute.privateExport")},
    {value: "public", label: t("contribute.publicReview")},
]);

const text = ref("");
const declaredProvenance = ref<Provenance>("unknown");
const visibility = ref<Visibility>("private");
const consent = ref(false);
const aiFlavor = ref(3);
const wantReadOn = ref(3);
const loading = ref(false);
const step = ref<SubmitStep>("draft");
const textId = ref("");
const charCount = ref(0);
const submittedScores = ref({aiFlavor: 0, wantReadOn: 0});

const filters = reactive<UiFilters>({
    review: settings.value.review,
    minLevel: settings.value.minLevel,
    namespaces: [...settings.value.namespaces],
    scanAll: true,
});
const nsOptions = namespaceOptions();
const allIssues = ref<Issue[]>([]);
const filteredIssues = computed(() => applyFilters(allIssues.value, filters));
const groups = computed<RuleGroup[]>(() => groupByRule(filteredIssues.value));
const summary = computed(() => summarize(filteredIssues.value));
const ranges = computed(() => issueRanges(text.value, filteredIssues.value));
const activeRule = ref<RegexRuleRecord | null>(null);
const activeRuleId = ref<string | null>(null);
const locateOffset = ref<number | null>(null);

const textHost = ref<HTMLElement | null>(null);
const selectedSpan = ref<{start: number; end: number; text: string} | null>(null);
const annotationNote = ref("");
const annotationLoading = ref(false);

/**
 * 更新过滤状态，并同步到本地设置中。
 */
function updateFilters(next: UiFilters): void {
    Object.assign(filters, next);
    patch({
        review: next.review,
        minLevel: next.minLevel,
        namespaces: [...next.namespaces],
        scanAll: next.scanAll,
    });
}

/**
 * 从 DOM Selection 反算正文 UTF-16 半开区间。
 */
function offsetInHost(node: Node, innerOffset: number): number | null {
    const host = textHost.value;
    if (!host) {
        return null;
    }
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let current = walker.nextNode();
    while (current) {
        if (current === node) {
            return offset + innerOffset;
        }
        offset += current.textContent?.length ?? 0;
        current = walker.nextNode();
    }
    return null;
}

/**
 * 用户在揭示后的正文中选段，记录待提交 span。
 */
function captureSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
    }
    const range = selection.getRangeAt(0);
    const host = textHost.value;
    if (!host || !host.contains(range.commonAncestorContainer)) {
        return;
    }
    const start = offsetInHost(range.startContainer, range.startOffset);
    const end = offsetInHost(range.endContainer, range.endOffset);
    if (start === null || end === null || start === end) {
        return;
    }
    const normalized = {start: Math.min(start, end), end: Math.max(start, end)};
    selectedSpan.value = {...normalized, text: text.value.slice(normalized.start, normalized.end)};
}

/**
 * 点正文时同步右侧命中卡片激活态。
 */
function onTextClick(event: MouseEvent): void {
    captureSelection();
    const selection = window.getSelection();
    const node = selection?.focusNode;
    if (!node) {
        return;
    }
    const offset = offsetInHost(node, selection?.focusOffset ?? 0);
    if (offset === null) {
        return;
    }
    const issue = issueAtOffset(text.value, filteredIssues.value, offset);
    activeRuleId.value = issue?.rule.id ?? null;
}

/**
 * 点右侧命中时激活对应规则。
 */
function onLocateIssue(issue: Issue): void {
    activeRuleId.value = issue.rule.id;
    locateOffset.value = offsetOf(text.value, issue);
}

/**
 * 上传正文、先落盲评，再扫描并写入 MachineRecord。
 */
async function submitBlindReview(): Promise<void> {
    if (!consent.value) {
        notification.error("请先确认授权与保留说明");
        return;
    }
    loading.value = true;
    try {
        const created = await $fetch<{textId: string; charCount: number}>("/api/texts", {
            method: "POST",
            body: {
                text: text.value,
                declaredProvenance: declaredProvenance.value,
                visibility: visibility.value,
                consent: consent.value,
            },
        });
        textId.value = created.textId;
        charCount.value = created.charCount;

        await $fetch("/api/judgments", {
            method: "POST",
            body: {
                textId: created.textId,
                aiFlavor: aiFlavor.value,
                wantReadOn: wantReadOn.value,
            },
        });
        submittedScores.value = {aiFlavor: aiFlavor.value, wantReadOn: wantReadOn.value};

        allIssues.value = scan(text.value, true);
        await $fetch("/api/scans", {
            method: "POST",
            body: {
                textId: created.textId,
                engineVersion: registry.value.version,
                hits: allIssues.value.map((issue) => {
                    const start = offsetOf(text.value, issue);
                    return {
                        ruleId: issue.rule.id,
                        span: {start, end: start + issue.match.length},
                        level: issue.rule.level,
                        review: issue.rule.review,
                    };
                }),
            },
        });

        step.value = "report";
        notification.success(t("contribute.blindReviewSaved"));
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "Submission failed"));
    } finally {
        loading.value = false;
    }
}

/**
 * 提交当前选段的自然语言标注，note 原样发送给后端保存。
 */
async function submitAnnotation(): Promise<void> {
    if (!selectedSpan.value || !annotationNote.value.trim()) {
        return;
    }
    annotationLoading.value = true;
    try {
        await $fetch("/api/annotations", {
            method: "POST",
            body: {
                textId: textId.value,
                target: "original",
                span: {start: selectedSpan.value.start, end: selectedSpan.value.end},
                note: annotationNote.value,
            },
        });
        notification.success(t("contribute.annotationSaved"));
        selectedSpan.value = null;
        annotationNote.value = "";
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "Save annotation failed"));
    } finally {
        annotationLoading.value = false;
    }
}
</script>

<template>
    <div class="flex h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <main v-if="step === 'draft'" class="min-h-0 flex-1 overflow-auto">
            <!-- 上传 + 盲评 -->
            <form class="mx-auto grid max-w-5xl gap-5 px-4 py-5" @submit.prevent="submitBlindReview">
                <section class="grid gap-2">
                    <div class="flex items-center justify-between gap-3">
                        <h1 class="text-lg font-semibold">{{ t("contribute.title") }}</h1>
                        <span class="text-xs text-[var(--text-muted)]">{{ t("contribute.charCount", {count: text.length}) }}</span>
                    </div>
                    <textarea v-model="text" class="min-h-[42vh] resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 font-mono text-sm leading-relaxed outline-none focus:border-[var(--accent-main)]" :placeholder="t('contribute.textPlaceholder')" required maxlength="60000" />
                </section>
                <section class="grid gap-4 md:grid-cols-2">
                    <FormSelect v-model="declaredProvenance" :label="t('contribute.sourceLabel')" :options="provenanceOptions" />
                    <FormSelect v-model="visibility" :label="t('contribute.visibilityLabel')" :options="visibilityOptions" />
                </section>
                <section class="grid gap-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-4">
                    <label class="grid gap-2">
                        <span class="text-sm font-medium">{{ t("contribute.aiFlavorLabel", {count: aiFlavor}) }}</span>
                        <input v-model.number="aiFlavor" type="range" min="0" max="5" step="1">
                        <div class="flex justify-between text-xs text-[var(--text-muted)]"><span>{{ t("contribute.aiFlavorLow") }}</span><span>{{ t("contribute.aiFlavorHigh") }}</span></div>
                    </label>
                    <label class="grid gap-2">
                        <span class="text-sm font-medium">{{ t("contribute.wantReadOnLabel", {count: wantReadOn}) }}</span>
                        <input v-model.number="wantReadOn" type="range" min="0" max="5" step="1">
                        <div class="flex justify-between text-xs text-[var(--text-muted)]"><span>{{ t("contribute.wantReadOnLow") }}</span><span>{{ t("contribute.wantReadOnHigh") }}</span></div>
                    </label>
                    <SwitchField v-model="consent" :label="t('contribute.consentText')" />
                </section>
                <div class="flex justify-end">
                    <button class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-white hover:brightness-105 disabled:opacity-60" :disabled="loading || !text.trim()">
                        <span class="i-lucide-send" />
                        <span>{{ loading ? t("contribute.submitting") : t("contribute.submitBlindReview") }}</span>
                    </button>
                </div>
            </form>
        </main>
        <main v-else class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
            <!-- 正文 + span 标注 -->
            <section class="flex min-h-0 flex-col border-b border-[var(--border-color)] md:border-b-0 md:border-r">
                <div class="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-2 text-sm">
                    <span>{{ t("contribute.textHighlight") }}</span>
                    <span class="text-[var(--text-muted)]">{{ t("contribute.visibleCharCount", {count: charCount}) }}</span>
                </div>
                <div ref="textHost" class="min-h-0 flex-1" @mouseup="captureSelection" @click="onTextClick">
                    <ReadOnlyHighlightedText :text="text" :ranges="ranges" :locate-offset="locateOffset" />
                </div>
                <div v-if="selectedSpan" class="grid gap-2 border-t border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                    <div class="line-clamp-2 text-xs text-[var(--text-muted)]">{{ t("contribute.selectedSpan", {text: selectedSpan.text}) }}</div>
                    <textarea v-model="annotationNote" class="min-h-20 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-sm outline-none focus:border-[var(--accent-main)]" :placeholder="t('contribute.annotationPlaceholder')" maxlength="2000" />
                    <div class="flex justify-end gap-2">
                        <button class="h-8 rounded-md px-3 text-sm hover:bg-[var(--bg-hover)]" type="button" @click="selectedSpan = null">{{ t("contribute.cancel") }}</button>
                        <button class="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-sm font-medium text-white disabled:opacity-60" type="button" :disabled="annotationLoading || !annotationNote.trim()" @click="submitAnnotation">
                            <span class="i-lucide-message-square-plus" />
                            <span>{{ t("contribute.saveAnnotation") }}</span>
                        </button>
                    </div>
                </div>
            </section>
            <!-- 揭示报告 -->
            <section class="flex min-h-0 flex-col">
                <div class="grid gap-1 border-b border-[var(--border-color)] px-4 py-3 text-sm">
                    <div class="flex flex-wrap items-center gap-3">
                        <span class="font-medium">{{ t("contribute.blindReviewSavedTitle") }}</span>
                        <span class="text-[var(--text-muted)]">{{ t("contribute.aiFlavorScore", {score: submittedScores.aiFlavor}) }}</span>
                        <span class="text-[var(--text-muted)]">{{ t("contribute.wantReadOnScore", {score: submittedScores.wantReadOn}) }}</span>
                        <span class="text-[var(--text-muted)]">engine {{ registry.version }}</span>
                    </div>
                    <div class="text-xs text-[var(--text-muted)]">{{ t("contribute.hitSummary", {total: summary.total, high: summary.high, medium: summary.medium, low: summary.low}) }}</div>
                </div>
                <FilterControls :filters="filters" :namespace-options="nsOptions" @update:filters="updateFilters" />
                <div class="min-h-0 flex-1">
                    <IssueList
                        :groups="groups"
                        :has-text="text.trim().length > 0"
                        :active-rule-id="activeRuleId"
                        @open-rule="(rule) => (activeRule = rule)"
                        @locate-issue="onLocateIssue"
                    />
                </div>
            </section>
        </main>
        <RuleDetailDialog :rule="activeRule" @close="activeRule = null" />
    </div>
</template>

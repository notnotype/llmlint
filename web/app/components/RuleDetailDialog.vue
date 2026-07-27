<script setup lang="ts">
import {computed} from "vue";
import type {Issue} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import Dialog from "./common/Dialog.vue";

const props = defineProps<{rule: Issue["rule"] | null}>();
const emit = defineEmits<{(e: "close"): void}>();
const {t} = useLlmlintI18n();

const open = computed({
    get: () => props.rule !== null,
    set: (visible: boolean) => {
        if (!visible) {
            emit("close");
        }
    },
});
</script>

<template>
    <Dialog v-model="open" :title="rule?.title ?? ''" width="min(720px, calc(100vw - 32px))">
        <div v-if="rule" class="space-y-4">
            <div class="flex flex-wrap items-center gap-x-2 font-mono text-xs text-[var(--text-muted)]">
                <span>{{ rule.id }}</span>
                <span>· {{ rule.namespace }}</span>
                <span>· {{ rule.ruleset }}</span>
            </div>
            <DimensionBadges :rule="rule" />
            <p v-if="rule.note" class="rounded-md bg-[var(--bg-subtle)] p-2 text-sm text-[var(--text-secondary)]">{{ rule.note }}</p>

            <!-- handler 规则无 regex 模式列表，只展示 builtin 名 -->
            <section v-if="'detector' in rule">
                <h3 class="text-sm font-medium text-[var(--text-muted)]">{{ t("ruleDetail.pattern") }}</h3>
                <ul class="mt-1 space-y-1">
                    <li v-for="(target, index) in rule.detector.targets" :key="index" class="overflow-x-auto rounded bg-[var(--bg-subtle)] p-1.5 font-mono text-xs">{{ target }}</li>
                </ul>
            </section>
            <section v-else>
                <h3 class="text-sm font-medium text-[var(--text-muted)]">{{ t("ruleDetail.pattern") }}</h3>
                <p class="mt-1 rounded bg-[var(--bg-subtle)] p-1.5 font-mono text-xs">builtin: {{ rule.handler.name }}</p>
            </section>

            <section>
                <h3 class="text-sm font-medium text-[var(--text-muted)]">{{ t("ruleDetail.action") }}</h3>
                <ul v-if="rule.action.type === 'replace'" class="mt-1 space-y-1 text-sm">
                    <li v-for="(rep, index) in rule.action.replacements" :key="index" class="font-mono">
                        <span v-if="rep === ''" class="text-[var(--text-muted)]">{{ t("ruleDetail.deleteReplacement") }}</span>
                        <span v-else>{{ rep }}</span>
                    </li>
                </ul>
                <p v-else class="mt-1 text-sm text-[var(--text-secondary)]">{{ rule.action.message }}</p>
            </section>

            <section v-if="rule.examples && rule.examples.length">
                <h3 class="text-sm font-medium text-[var(--text-muted)]">{{ t("ruleDetail.examples") }}</h3>
                <ul class="mt-1 space-y-2">
                    <!-- hit=false 是「形近但不该报」的对照例，不能画成删除线坏例 -->
                    <li v-for="(ex, index) in rule.examples" :key="index" class="text-sm">
                        <p v-if="ex.hit" class="text-red-600 line-through decoration-red-400">{{ ex.text }}</p>
                        <p v-else class="text-emerald-700">{{ ex.text }}</p>
                        <p v-if="ex.fix" class="text-emerald-700">{{ ex.fix }}</p>
                        <p v-if="ex.reason" class="text-xs text-[var(--text-muted)]">{{ ex.reason }}</p>
                    </li>
                </ul>
            </section>
        </div>
    </Dialog>
</template>

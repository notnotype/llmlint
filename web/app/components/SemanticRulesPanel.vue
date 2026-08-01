<script setup lang="ts">
import {ref} from "vue";
import type {SemanticRuleRecord} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

// 只读折叠面板：本页（纯 regex）不检测、只能靠读上下文判断的语义规则
defineProps<{rules: SemanticRuleRecord[]}>();
const open = ref(false);
const {t} = useLlmlintI18n();
</script>

<template>
    <div class="border-t border-zinc-200 dark:border-zinc-800">
        <button class="flex w-full items-center gap-2 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50" @click="open = !open">
            <span class="i-lucide-bot" />
            {{ t("semanticRules.title", {count: rules.length}) }}
            <span class="ml-auto" :class="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
        </button>
        <div v-if="open" class="px-4 pb-3">
            <p class="mb-2 text-xs text-zinc-500">{{ t("semanticRules.description") }}</p>
            <div v-for="rule in rules" :key="rule.id" class="mb-2 rounded border border-zinc-200 p-2 dark:border-zinc-800">
                <div class="flex flex-wrap items-center gap-2 text-sm">
                    <span class="font-medium">{{ rule.title }}</span>
                    <span class="font-mono text-xs text-zinc-500">[{{ rule.namespace }}]</span>
                    <ScopeBadge :scope="rule.scope" />
                </div>
                <p class="mt-1 whitespace-pre-wrap text-xs text-zinc-500">{{ rule.detector.prompt }}</p>
            </div>
        </div>
    </div>
</template>

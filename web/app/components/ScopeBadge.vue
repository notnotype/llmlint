<script setup lang="ts">
import {computed} from "vue";
import type {ResolvedScanScope} from "llmlint/types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

const props = defineProps<{scope: ResolvedScanScope}>();
const {t} = useLlmlintI18n();

const label = computed(() => {
    const layer = props.scope.layer === "narrative"
        ? t("rules.scopeNarrative")
        : props.scope.layer === "quoted"
            ? t("rules.scopeQuoted")
            : t("rules.scopeAll");
    if (!props.scope.position) {
        return layer;
    }
    const position = props.scope.position.kind === "opening"
        ? t("rules.scopeOpening", {chars: props.scope.position.chars})
        : t("rules.scopeEnding", {chars: props.scope.position.chars});
    return `${layer} · ${position}`;
});
</script>

<template>
    <span class="rounded border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">{{ label }}</span>
</template>

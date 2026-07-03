<script setup lang="ts">
import {ref, watch} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import Dialog from "./common/Dialog.vue";

const emit = defineEmits<{(e: "close"): void}>();
const open = ref(true);
const {t} = useLlmlintI18n();

watch(open, (visible) => {
    if (!visible) {
        emit("close");
    }
});
</script>

<template>
    <Dialog v-model="open" :title="t('about.title')" width="min(560px, calc(100vw - 32px))">
        <div class="space-y-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            <p>{{ t("about.description") }}</p>
            <section>
                <h3 class="font-medium text-[var(--text-main)]">{{ t("about.usage") }}</h3>
                <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>{{ t("about.actions") }}</li>
                    <li>{{ t("about.highlight") }}</li>
                    <li>{{ t("about.mask") }}</li>
                    <li>{{ t("about.copy") }}</li>
                </ul>
            </section>
            <section>
                <h3 class="font-medium text-[var(--text-main)]">{{ t("about.dimensions") }}</h3>
                <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>{{ t("about.level") }}</li>
                    <li>{{ t("about.review") }}</li>
                </ul>
            </section>
            <p class="rounded-md border border-amber-500/25 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-200">{{ t("about.mindset") }}</p>
            <p class="text-xs text-[var(--text-muted)]">
                <a class="underline hover:text-[var(--text-main)]" href="https://github.com/notnotype/llmlint" target="_blank" rel="noreferrer">{{ t("about.github") }}</a>
            </p>
        </div>
    </Dialog>
</template>

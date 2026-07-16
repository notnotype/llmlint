<script setup lang="ts">
defineProps<{
    kind: "report" | "dataset";
}>();
</script>

<template>
    <aside class="workspace-preview relative min-h-96 overflow-hidden border border-[var(--border-strong)] bg-[var(--bg-panel)] p-4">
        <div class="workspace-preview-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <header class="relative flex items-center justify-between border-b border-[var(--border-color)] pb-3">
            <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 bg-[var(--accent-pop)]" />
                <span class="font-mono text-[11px] font-black text-[var(--text-main)]">{{ kind === "report" ? "REPORT / SIGNAL BOARD" : "DATASET / PARALLEL VIEW" }}</span>
            </div>
            <span class="inline-flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                <span class="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" />
                LOCAL
            </span>
        </header>

        <div v-if="kind === 'report'" class="relative mt-4 grid gap-4">
            <div class="grid grid-cols-3 gap-2">
                <div v-for="metric in ['AUC', 'PAIR', 'RULES']" :key="metric" class="border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                    <div class="font-mono text-[9px] text-[var(--text-muted)]">{{ metric }}</div>
                    <div class="mt-1 font-mono text-xl font-black text-[var(--text-main)]">--</div>
                </div>
            </div>

            <div class="report-chart relative flex h-36 items-end gap-2 border-y border-[var(--border-color)] px-3 pb-3 pt-7" aria-hidden="true">
                <span v-for="height in [34, 58, 43, 78, 52, 88, 67, 94, 74]" :key="height" class="min-w-0 flex-1 bg-[var(--accent-main)]/25" :style="{height: `${height}%`}">
                    <span class="block h-1 w-full bg-[var(--accent-main)]" />
                </span>
                <span class="absolute left-3 top-2 font-mono text-[9px] text-[var(--text-muted)]">DOC SCORE / DISTRIBUTION</span>
            </div>

            <div class="grid gap-2">
                <div v-for="(rule, index) in ['contrast.binary', 'transition.summary', 'jargon.business']" :key="rule" class="grid grid-cols-[1fr_5rem_3rem] items-center gap-3 border-b border-[var(--border-color)] py-2 text-xs">
                    <span class="truncate font-mono text-[var(--text-secondary)]">{{ rule }}</span>
                    <span class="h-1.5 bg-[var(--bg-subtle)]"><span class="block h-full" :class="index === 0 ? 'w-[82%] bg-[var(--accent-pop)]' : index === 1 ? 'w-[64%] bg-[var(--accent-main)]' : 'w-[41%] bg-[var(--accent-signal)]'" /></span>
                    <span class="text-right font-mono text-[var(--text-muted)]">{{ ['8.2', '6.4', '4.1'][index] }}</span>
                </div>
            </div>
        </div>

        <div v-else class="relative mt-4 grid min-h-[22rem] grid-cols-[8rem_1fr] border border-[var(--border-color)]">
            <div class="border-r border-[var(--border-color)] bg-[var(--bg-subtle)]/45 p-2">
                <div class="mb-3 font-mono text-[9px] text-[var(--text-muted)]">CORPUS TREE</div>
                <div v-for="(item, index) in ['wuxia / 01', 'xuanhuan / 02', 'light-novel / 03', 'gongdou / 04']" :key="item" class="mb-1 flex items-center gap-1.5 px-1 py-1 text-[10px]" :class="index === 1 ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-muted)]'">
                    <span class="i-lucide-file-text h-3 w-3" />
                    <span class="truncate font-mono">{{ item }}</span>
                </div>
            </div>
            <div class="grid min-w-0 grid-cols-2">
                <div v-for="column in ['REFERENCE', 'RENDER']" :key="column" class="min-w-0 border-r border-[var(--border-color)] p-3 last:border-r-0">
                    <div class="mb-3 flex items-center justify-between font-mono text-[9px] text-[var(--text-muted)]">
                        <span>{{ column }}</span>
                        <span>{{ column === 'REFERENCE' ? 'HUMAN' : 'MODEL-02' }}</span>
                    </div>
                    <div class="space-y-2" aria-hidden="true">
                        <span v-for="width in [94, 81, 88, 65, 92, 73, 84, 58, 90, 76]" :key="width" class="block h-1.5 bg-[var(--border-color)]" :style="{width: `${width}%`}" />
                        <span class="block h-1.5 w-[71%] bg-[var(--accent-pop)]/65" />
                        <span class="block h-1.5 w-[86%] bg-[var(--border-color)]" />
                        <span class="block h-1.5 w-[48%] bg-[var(--accent-signal)]/70" />
                    </div>
                </div>
            </div>
        </div>
    </aside>
</template>

<style scoped>
.workspace-preview {
    border-radius: 3px;
    box-shadow: 7px 7px 0 color-mix(in srgb, var(--manga-ink) 8%, transparent);
    clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%);
}

.workspace-preview::after {
    position: absolute;
    top: 0;
    right: 21px;
    width: 1px;
    height: 32px;
    background: var(--border-strong);
    content: "";
    transform: rotate(-45deg);
    transform-origin: top;
}

.workspace-preview-grid {
    background-image: linear-gradient(var(--manga-dot) 1px, transparent 1px), linear-gradient(90deg, var(--manga-dot) 1px, transparent 1px);
    background-size: 18px 18px;
    opacity: 0.28;
}

.report-chart {
    background-image: repeating-linear-gradient(to top, transparent 0 27px, var(--manga-dot) 27px 28px);
}
</style>

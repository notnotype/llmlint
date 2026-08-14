<script setup lang="ts">
defineProps<{
    mode: "login";
}>();
</script>

<template>
    <main class="auth-workspace mx-auto grid w-full max-w-6xl flex-1 items-stretch px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] lg:px-8 lg:py-10">
        <section class="auth-manuscript relative min-h-72 overflow-hidden border border-[var(--border-strong)] bg-[var(--bg-input)] p-5 lg:min-h-0 lg:p-8">
            <div class="absolute inset-y-0 left-10 w-px bg-[var(--accent-pop)]/55" aria-hidden="true" />
            <header class="relative ml-8 flex items-center justify-between border-b border-[var(--border-color)] pb-3">
                <span class="font-mono text-[10px] font-black text-[var(--accent-text)]">MANUSCRIPT / SOURCE-01</span>
                <span class="font-mono text-[9px] text-[var(--text-muted)]">SESSION / RETURN</span>
            </header>

            <div class="relative ml-8 mt-8 max-w-xl font-mono text-sm leading-8 text-[var(--text-secondary)]">
                <p><mark class="bg-[var(--accent-pop)]/18 px-1 text-[var(--text-main)]">值得注意的是</mark>，这不是一次普通的尝试，而是一场深刻的变革。</p>
                <p class="mt-4">他站在窗前，目光如刀，心跳如鼓，思绪如潮。夜色浸染着沉默的城市。</p>
                <p class="mt-4">我们要做的，<mark class="bg-[var(--accent-signal)]/24 px-1 text-[var(--text-main)]">不是修修补补，而是</mark>从底层重构。</p>
            </div>

            <div class="relative ml-8 mt-8 grid max-w-xl grid-cols-3 border-y border-[var(--border-color)] py-3 font-mono text-[10px]">
                <div><span class="block text-[var(--text-muted)]">ISSUES</span><b class="mt-1 block text-lg text-[var(--accent-pop)]">03</b></div>
                <div><span class="block text-[var(--text-muted)]">COMMENTS</span><b class="mt-1 block text-lg text-[var(--accent-signal)]">01</b></div>
                <div><span class="block text-[var(--text-muted)]">STATUS</span><b class="mt-1 block text-lg text-[var(--accent-main)]">OPEN</b></div>
            </div>

            <span class="auth-stamp absolute bottom-5 right-5 flex h-14 w-14 items-center justify-center font-mono text-[10px] font-black text-[var(--accent-text)]" aria-hidden="true">L-01</span>
        </section>

        <section class="flex items-center justify-center border border-t-0 border-[var(--border-strong)] bg-[var(--bg-panel)] p-5 lg:border-l-0 lg:border-t lg:p-8">
            <slot />
        </section>
    </main>
</template>

<style scoped>
.auth-manuscript {
    background-image: linear-gradient(to bottom, transparent 31px, color-mix(in srgb, var(--border-color) 32%, transparent) 32px);
    background-size: 100% 32px;
}

.auth-stamp {
    border: 2px solid var(--accent-main);
    transform: rotate(-7deg);
}

:slotted(.auth-form) {
    border-radius: 3px;
    box-shadow: 5px 5px 0 color-mix(in srgb, var(--manga-ink) 9%, transparent);
}
</style>

<script setup lang="ts">
import {onMounted, ref} from "vue";
import {useLlmlintTheme} from "./composables/useLlmlintTheme";
import NotificationViewport from "./components/common/NotificationViewport.vue";

// 路由外壳：统一挂载 llmlint 主题变量，页面只负责自己的布局。
const themeHostRef = ref<HTMLElement | null>(null);
const {mountThemeHost} = useLlmlintTheme();

onMounted(() => {
    mountThemeHost(themeHostRef.value);
});
</script>

<template>
    <div ref="themeHostRef" class="llmlint-theme min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
        <NuxtPage />
        <NotificationViewport />
    </div>
</template>

<style>
.llmlint-theme {
    position: relative;
    isolation: isolate;
    font-family: "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif;
    letter-spacing: 0;
}

.llmlint-theme::before {
    position: fixed;
    z-index: -1;
    inset: 0;
    background-image: radial-gradient(circle, var(--manga-dot) 0 0.75px, transparent 0.9px);
    background-size: 7px 7px;
    content: "";
    opacity: 0.28;
    pointer-events: none;
}

.llmlint-theme[data-theme="dark"]::before {
    opacity: 0.18;
}

.llmlint-theme ::selection {
    background: color-mix(in srgb, var(--accent-main) 34%, transparent);
    color: var(--text-main);
}

.llmlint-theme :where(button, a, input, textarea, select):focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
}
</style>

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

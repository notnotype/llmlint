<script setup lang="ts">
// W9-C 入口统一：`/` 恒定重定向到 /contribute（唯一检测入口；playground 编辑器迁 /playground，不进导航）。
// SPA(ssr:false) 下选路由级 redirect——definePageMeta.redirect 构建期编译进 vue-router 路由表，
// 直访 `/`（初始路由解析）与客户端导航（点 logo 等）都在组件渲染前生效，无闪屏、无需运行时跳转逻辑。
definePageMeta({
    redirect: "/contribute",
});
</script>

<template>
    <!-- 路由级 redirect 先于渲染生效，本组件实际不会出现在页面上，占位模板仅满足 SFC 结构 -->
    <div />
</template>

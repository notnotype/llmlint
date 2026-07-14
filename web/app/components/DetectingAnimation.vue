<script setup lang="ts">
// 检测中动画（Task 17 工单 D）：scan 未落库时占据色环位置的脉冲雷达（纯 CSS，无依赖）；
// prefers-reduced-motion 时降为静态图标。父组件负责旁边的「检测中」文案。
</script>

<template>
    <!-- 脉冲雷达：中心圆点 + 两圈扩散波纹 + 旋转扫描线 -->
    <div class="radar relative h-32 w-32 shrink-0" role="status">
        <span class="absolute inset-0 rounded-full border border-[var(--border-color)] opacity-60" />
        <span class="ping absolute inset-3 rounded-full border-2 border-[var(--accent-main)]" />
        <span class="ping ping-late absolute inset-3 rounded-full border-2 border-[var(--accent-main)]" />
        <!-- 旋转扫描扇面 -->
        <span class="sweep absolute inset-3 rounded-full" />
        <span class="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-main)]" />
    </div>
</template>

<style scoped>
/* 扩散波纹：两圈错峰 */
.ping {
    animation: radar-ping 2.4s ease-out infinite;
}
.ping-late {
    animation-delay: 1.2s;
}
@keyframes radar-ping {
    0% { transform: scale(0.2); opacity: 0.9; }
    100% { transform: scale(1); opacity: 0; }
}
/* 扫描扇面：conic-gradient 尾迹 + 匀速旋转 */
.sweep {
    background: conic-gradient(from 0deg, transparent 0deg, transparent 300deg, color-mix(in srgb, var(--accent-main) 35%, transparent) 360deg);
    animation: radar-sweep 2.4s linear infinite;
}
@keyframes radar-sweep {
    to { transform: rotate(360deg); }
}
/* 减少动效偏好：全部动画停用，只留静态雷达轮廓 */
@media (prefers-reduced-motion: reduce) {
    .ping, .sweep {
        animation: none;
    }
    .ping-late {
        display: none;
    }
    .ping {
        transform: scale(0.7);
        opacity: 0.4;
    }
}
</style>

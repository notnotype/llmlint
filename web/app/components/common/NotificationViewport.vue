<script setup lang="ts">
import {useNotification, type NotificationItem} from "../../composables/useNotification";

const {notifications, remove} = useNotification();

function toneClass(item: NotificationItem): string {
    if (item.tone === "success") {
        return "border-emerald-500/25 bg-emerald-600 text-white";
    }
    if (item.tone === "error") {
        return "border-red-500/25 bg-red-600 text-white";
    }
    if (item.tone === "warning") {
        return "border-amber-500/25 bg-amber-600 text-white";
    }
    return "border-sky-500/25 bg-zinc-900 text-white";
}
</script>

<template>
    <ClientOnly>
        <div class="pointer-events-none fixed bottom-4 left-1/2 z-60 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
            <TransitionGroup name="notice">
                <div v-for="item in notifications" :key="item.id" class="pointer-events-auto flex w-full items-center gap-3 rounded-lg border px-4 py-2 text-sm shadow-lg" :class="toneClass(item)">
                    <span class="min-w-0 flex-1">{{ item.message }}</span>
                    <button v-if="item.action" class="shrink-0 font-medium underline" @click="item.action.run(); remove(item.id)">{{ item.action.label }}</button>
                    <button class="shrink-0 opacity-75 hover:opacity-100" @click="remove(item.id)">
                        <span class="i-lucide-x" />
                    </button>
                </div>
            </TransitionGroup>
        </div>
    </ClientOnly>
</template>

<style scoped>
.notice-enter-active,
.notice-leave-active {
    transition: all 0.18s ease;
}
.notice-enter-from,
.notice-leave-to {
    opacity: 0;
    transform: translateY(8px);
}
</style>

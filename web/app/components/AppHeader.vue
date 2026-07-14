<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import type {LlmlintRegistry} from "../types";
import {useAuthState} from "../composables/useAuthState";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useLlmlintTheme} from "../composables/useLlmlintTheme";
import {useNotification} from "../composables/useNotification";
import type {DropdownItem} from "./common/dropdown.types";
import Dropdown from "./common/Dropdown.vue";
import SettingsDialog from "./SettingsDialog.vue";

// 顶部栏：产品标识 + 导航 + 辅助入口 + 设置/用户。
// registry 由检测页传入，当前 header 消费这个 prop 但不展示规则统计。
defineProps<{registry?: LlmlintRegistry}>();

// useRoute 由 Nuxt 自动导入。
const route = useRoute();
const router = useRouter();
const auth = useAuthState();
const currentUser = auth.user;
const authEnabled = auth.authEnabled;
const authLoaded = auth.loaded;
const notification = useNotification();
const {resolvedTheme, setTheme} = useLlmlintTheme();
const {t} = useLlmlintI18n();
const showAbout = ref(false);
const showSettings = ref(false);
const userMenuItems = computed<DropdownItem[]>(() => {
    if (currentUser.value) {
        return [
            {label: t("header.contribute"), value: "contribute", iconClass: "i-lucide-scan-text", active: route.path === "/contribute"},
            {label: t("header.logout"), value: "logout", iconClass: "i-lucide-log-out"},
        ];
    }
    return [
        {label: t("header.login"), value: "login", iconClass: "i-lucide-log-in", active: route.path === "/login"},
        {label: t("header.register"), value: "register", iconClass: "i-lucide-user-plus", active: route.path === "/register"},
    ];
});
const userInitial = computed(() => {
    const name = currentUser.value?.displayName || currentUser.value?.username || "";
    return name.trim().slice(0, 1).toLocaleUpperCase() || "U";
});
const userButtonTitle = computed(() => currentUser.value?.username || t("header.account"));

function toggleDark() {
    setTheme(resolvedTheme.value === "dark" ? "light" : "dark");
}

/**
 * 处理账号菜单动作。
 */
async function handleUserMenuSelect(value: string): Promise<void> {
    if (value === "contribute") {
        await router.push("/contribute");
        return;
    }
    if (value === "login") {
        await router.push(`/login?redirect=${encodeURIComponent(route.fullPath)}`);
        return;
    }
    if (value === "register") {
        await router.push(`/register?redirect=${encodeURIComponent(route.fullPath)}`);
        return;
    }
    if (value === "logout") {
        await logout();
    }
}

/**
 * 登出当前账号，若正在贡献页则回到登录页。
 */
async function logout() {
    try {
        await auth.logout();
        notification.success(t("notify.logoutOk"));
        if (route.path === "/contribute") {
            await router.push(`/login?redirect=${encodeURIComponent(route.fullPath)}`);
        }
    } catch (caught) {
        notification.error(auth.errorMessage(caught, t("notify.logoutFailed")));
    }
}

onMounted(async () => {
    if (!auth.loaded.value) {
        try {
            await auth.refresh();
        } catch {
            auth.loaded.value = true;
        }
    }
});
</script>

<template>
    <header class="sticky top-0 z-40 flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel)]/92 text-[var(--text-main)] backdrop-blur">
        <div class="flex min-w-0 items-center gap-2">
            <NuxtLink to="/" class="flex h-12 w-12 shrink-0 items-center justify-center text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)]" title="llmlint">
                <span class="i-lucide-scan-text h-5 w-5" />
            </NuxtLink>
            <div class="flex min-w-0 items-baseline gap-2">
                <span class="text-lg font-bold tracking-tight">llmlint</span>
                <span class="hidden text-sm text-[var(--text-muted)] sm:inline">{{ t("header.subtitle") }}</span>
            </div>
            <div class="hidden h-4 w-px bg-[var(--border-color)] sm:block"></div>
            <!-- 主导航（W9-C 入口统一：playground 检测链接已删，/contribute 即唯一「检测」入口） -->
            <nav class="flex min-w-0 items-center gap-1 text-sm">
                <NuxtLink to="/contribute" class="rounded px-2 py-1 hover:bg-[var(--bg-hover)]" :class="route.path === '/contribute' ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-muted)]'">{{ t("header.contribute") }}</NuxtLink>
                <NuxtLink to="/report" class="rounded px-2 py-1 hover:bg-[var(--bg-hover)]" :class="route.path === '/report' ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-muted)]'">{{ t("header.report") }}</NuxtLink>
                <!-- 规则库入口（Task 15 P1-D /rules 规则页） -->
                <NuxtLink to="/rules" class="rounded px-2 py-1 hover:bg-[var(--bg-hover)]" :class="route.path === '/rules' ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-muted)]'">{{ t("header.rules") }}</NuxtLink>
                <NuxtLink to="/dataset" class="rounded px-2 py-1 hover:bg-[var(--bg-hover)]" :class="route.path === '/dataset' ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-muted)]'">{{ t("header.dataset") }}</NuxtLink>
            </nav>
        </div>
        <div class="flex shrink-0 items-center gap-1 text-sm text-[var(--text-muted)]">
            <a class="hidden h-8 items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] sm:inline-flex shadow-sm" href="https://github.com/notnotype/llmlint" target="_blank" rel="noreferrer">
                <span class="i-lucide-github h-4 w-4" />
                <span>{{ t("header.github") }}</span>
            </a>
            <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('header.about')" @click="showAbout = true">
                <span class="i-lucide-info h-4 w-4" />
            </button>
            <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('header.theme')" @click="toggleDark">
                <span v-if="resolvedTheme === 'dark'" class="i-lucide-sun h-4 w-4" />
                <span v-else class="i-lucide-moon h-4 w-4" />
            </button>
            <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('header.settings')" @click="showSettings = true">
                <span class="i-lucide-settings h-4 w-4" />
            </button>
            <Dropdown v-if="authLoaded && authEnabled" :items="userMenuItems" root-class="relative flex items-center" menu-class="right-0 top-full mt-2 w-44" @select="handleUserMenuSelect">
                <button type="button" class="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="userButtonTitle">
                    <span v-if="currentUser" class="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] text-[10px] font-semibold text-[var(--accent-text)]">{{ userInitial }}</span>
                    <span v-else class="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)]">
                        <span class="i-lucide-user h-3.5 w-3.5" />
                    </span>
                </button>
            </Dropdown>
            <AboutPanel v-if="showAbout" @close="showAbout = false" />
            <SettingsDialog v-model="showSettings" />
        </div>
    </header>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import {useAuthState} from "../composables/useAuthState";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useLlmlintTheme} from "../composables/useLlmlintTheme";
import {useNotification} from "../composables/useNotification";
import type {DropdownItem} from "./common/dropdown.types";
import Dropdown from "./common/Dropdown.vue";
import SettingsDialog from "./SettingsDialog.vue";

// 顶部栏：产品标识 + 导航 + 辅助入口 + 设置/用户。

// useRoute 由 Nuxt 自动导入。
const route = useRoute();
const router = useRouter();
const auth = useAuthState();
const currentUser = auth.user;
const notification = useNotification();
const {resolvedTheme, setTheme} = useLlmlintTheme();
const {t} = useLlmlintI18n();
const showAbout = ref(false);
const showSettings = ref(false);
const navItems = computed(() => [
    {to: "/", label: t("header.check")},
    {to: "/report", label: t("header.report")},
    {to: "/dataset", label: t("header.dataset")},
    {to: "/contribute", label: t("header.contribute")},
]);
const userMenuItems = computed<DropdownItem[]>(() => {
    if (currentUser.value) {
        return [
            {label: t("header.contribute"), value: "contribute", iconClass: "i-lucide-database-zap", active: route.path === "/contribute"},
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
    <header class="anime-header sticky top-0 z-40 flex min-h-12 shrink-0 flex-wrap items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel)]/94 text-[var(--text-main)] backdrop-blur">
        <div class="flex min-w-0 items-center gap-2">
            <NuxtLink to="/" class="anime-brand-mark flex h-12 w-12 shrink-0 items-center justify-center text-[var(--text-inverse)] transition-transform hover:-translate-y-0.5" title="llmlint">
                <span class="i-lucide-scan-text h-5 w-5" />
            </NuxtLink>
            <div class="flex min-w-0 items-baseline gap-2">
                <span class="anime-wordmark text-lg font-black">llmlint</span>
                <span class="hidden text-xs text-[var(--text-muted)] lg:inline">{{ t("header.subtitle") }}</span>
            </div>
            <div class="hidden h-5 w-px bg-[var(--border-strong)] md:block"></div>
            <!-- 主导航 -->
            <nav class="hidden min-w-0 items-center gap-1 text-sm md:flex">
                <NuxtLink v-for="item in navItems" :key="item.to" :to="item.to" class="anime-nav-link px-2.5 py-1.5 text-[var(--text-muted)]" :class="route.path === item.to ? 'is-active' : ''">{{ item.label }}</NuxtLink>
            </nav>
        </div>
        <div class="flex shrink-0 items-center gap-1 text-sm text-[var(--text-muted)]">
            <a class="hidden h-8 items-center gap-1.5 rounded border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent-main)] hover:text-[var(--text-main)] sm:inline-flex" href="https://github.com/notnotype/llmlint" target="_blank" rel="noreferrer">
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
            <Dropdown :items="userMenuItems" root-class="relative flex items-center" menu-class="right-0 top-full mt-2 w-44" @select="handleUserMenuSelect">
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
        <nav class="anime-mobile-nav flex h-9 w-full items-stretch overflow-x-auto border-t border-[var(--border-color)] px-2 md:hidden">
            <NuxtLink v-for="item in navItems" :key="`mobile-${item.to}`" :to="item.to" class="anime-nav-link flex min-w-18 flex-1 items-center justify-center px-2 text-xs text-[var(--text-muted)]" :class="route.path === item.to ? 'is-active' : ''">{{ item.label }}</NuxtLink>
        </nav>
    </header>
</template>

<style scoped>
.anime-header {
    box-shadow: 0 1px 0 color-mix(in srgb, var(--accent-main) 24%, transparent);
}

.anime-header::after {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: min(18rem, 38vw);
    height: 2px;
    background: linear-gradient(90deg, var(--accent-pop) 0 34%, var(--accent-signal) 34% 57%, var(--accent-main) 57%);
    content: "";
}

.anime-brand-mark {
    background: var(--manga-ink);
    clip-path: polygon(0 0, 100% 0, 100% 68%, 72% 100%, 0 100%);
}

.anime-wordmark {
    color: var(--manga-ink);
}

.anime-wordmark::after {
    color: var(--accent-pop);
    content: "/";
    margin-left: 0.2rem;
}

.anime-nav-link {
    position: relative;
    white-space: nowrap;
    transition: color 0.16s ease, background-color 0.16s ease;
}

.anime-nav-link:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.anime-nav-link.is-active {
    color: var(--text-main);
    font-weight: 800;
}

.anime-nav-link.is-active::after {
    position: absolute;
    right: 0.55rem;
    bottom: 0;
    left: 0.55rem;
    height: 2px;
    background: var(--accent-main);
    content: "";
}

@media (max-width: 767px) {
    .anime-header::after {
        bottom: 35px;
        width: 7rem;
    }
}
</style>

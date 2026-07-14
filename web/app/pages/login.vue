<script setup lang="ts">
import {onMounted, ref} from "vue";
import {useAuthState} from "../composables/useAuthState";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useNotification} from "../composables/useNotification";

const route = useRoute();
const router = useRouter();
const auth = useAuthState();
const notification = useNotification();
const {t} = useLlmlintI18n();

const username = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");

function redirectTarget(): string {
    const raw = typeof route.query.redirect === "string" ? route.query.redirect : "/contribute";
    return raw.startsWith("/") ? raw : "/contribute";
}

/**
 * 提交登录表单并回到原页面。
 */
async function submit(): Promise<void> {
    error.value = "";
    loading.value = true;
    try {
        const session = await $fetch<{user: typeof auth.user.value}>("/api/auth/login", {
            method: "POST",
            body: {username: username.value, password: password.value},
        });
        auth.user.value = session.user;
        auth.loaded.value = true;
        notification.success(t("auth.loginOk"));
        await router.push(redirectTarget());
    } catch (caught) {
        error.value = auth.errorMessage(caught, t("auth.loginFailed"));
    } finally {
        loading.value = false;
    }
}

onMounted(async () => {
    const user = auth.loaded.value ? auth.user.value : await auth.refresh();
    if (user) {
        await router.replace(redirectTarget());
    }
});
</script>

<template>
    <div class="flex min-h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <AuthWorkspace mode="login">
            <form class="auth-form grid w-full max-w-md gap-4 border border-[var(--border-strong)] bg-[var(--bg-input)] p-6" @submit.prevent="submit">
                <div class="grid gap-1">
                    <h1 class="text-lg font-semibold">{{ t("auth.loginTitle") }}</h1>
                    <p class="text-sm text-[var(--text-muted)]">{{ t("auth.loginDescription") }}</p>
                </div>
                <label class="grid gap-1.5">
                    <span class="text-xs font-medium text-[var(--text-muted)]">{{ t("auth.username") }}</span>
                    <input v-model.trim="username" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm outline-none focus:border-[var(--accent-main)]" autocomplete="username" required>
                </label>
                <label class="grid gap-1.5">
                    <span class="text-xs font-medium text-[var(--text-muted)]">{{ t("auth.password") }}</span>
                    <input v-model="password" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm outline-none focus:border-[var(--accent-main)]" type="password" autocomplete="current-password" required>
                </label>
                <p v-if="error" class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{{ error }}</p>
                <button class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-sm font-medium text-white hover:brightness-105 disabled:opacity-60" :disabled="loading">
                    <span class="i-lucide-log-in" />
                    <span>{{ loading ? t("auth.loginLoading") : t("auth.loginTitle") }}</span>
                </button>
                <NuxtLink class="text-center text-sm text-[var(--accent-main)] hover:underline" :to="`/register?redirect=${encodeURIComponent(redirectTarget())}`">{{ t("auth.registerLink") }}</NuxtLink>
            </form>
        </AuthWorkspace>
    </div>
</template>

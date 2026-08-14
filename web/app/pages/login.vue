<script setup lang="ts">
import {onMounted, ref} from "vue";
import {useAuthState} from "../composables/useAuthState";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

const route = useRoute();
const router = useRouter();
const auth = useAuthState();
const {t} = useLlmlintI18n();
const error = ref("");
const loading = ref(false);
const authReady = ref(false);

function redirectTarget(): string {
    const raw = typeof route.query.redirect === "string" ? route.query.redirect : "/contribute";
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/contribute";
}

function errorMessage(): string {
    if (route.query.error === "account_mapping_conflict") {
        return t("auth.ssoConflict");
    }
    if (route.query.error === "sso_failed") {
        return t("auth.ssoFailed");
    }
    return "";
}

function startSso(): void {
    loading.value = true;
    window.location.assign(`/api/auth/neurobook/start?redirect=${encodeURIComponent(redirectTarget())}`);
}

onMounted(async () => {
    error.value = errorMessage();
    const user = auth.loaded.value ? auth.user.value : await auth.refresh().catch(() => null);
    authReady.value = true;
    if (!auth.authEnabled.value || user) {
        await router.replace(redirectTarget());
    }
});
</script>

<template>
    <div class="flex min-h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <AuthWorkspace mode="login">
            <div class="auth-form grid w-full max-w-md gap-4 border border-[var(--border-strong)] bg-[var(--bg-input)] p-6">
                <div class="grid gap-1">
                    <h1 class="text-lg font-semibold">{{ t("auth.loginTitle") }}</h1>
                    <p class="text-sm text-[var(--text-muted)]">{{ t("auth.loginDescription") }}</p>
                </div>
                <p v-if="error" class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{{ error }}</p>
                <p v-if="authReady && !auth.ssoEnabled" class="rounded border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--text-muted)]">SSO 当前未启用，请联系管理员。</p>
                <button v-if="auth.ssoEnabled" class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-sm font-medium text-white hover:brightness-105 disabled:opacity-60" :disabled="loading" @click="startSso">
                    <span class="i-lucide-log-in" />
                    <span>{{ loading ? t("auth.ssoLoading") : t("auth.ssoLogin") }}</span>
                </button>
            </div>
        </AuthWorkspace>
    </div>
</template>

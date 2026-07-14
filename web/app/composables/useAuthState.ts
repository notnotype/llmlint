import {resolveApiErrorMessage} from "../utils/api-error";

export type AuthUser = {
    id: string;
    username: string;
    displayName: string;
    role: "admin" | "user";
    identityRole: "reader" | "writer" | "editor" | "pro";
    sessionVersion: number;
};

type AuthSession = {
    authEnabled: boolean;
    user: AuthUser | null;
};

/**
 * 客户端登录态。多个页面共享同一个 useState，避免 Header 和表单各查各的。
 */
export function useAuthState() {
    const user = useState<AuthUser | null>("llmlint-auth-user", () => null);
    const loaded = useState<boolean>("llmlint-auth-loaded", () => false);
    const authEnabled = useState<boolean>("llmlint-auth-enabled", () => true);

    /**
     * 刷新当前 session 用户。
     */
    async function refresh(): Promise<AuthUser | null> {
        const session = await $fetch<AuthSession>("/api/auth/me");
        authEnabled.value = session.authEnabled;
        user.value = session.user;
        loaded.value = true;
        return user.value;
    }

    /**
     * 登出并清理本地登录态。
     */
    async function logout(): Promise<void> {
        if (!authEnabled.value) {
            return;
        }
        await $fetch("/api/auth/logout", {method: "POST"});
        user.value = null;
        loaded.value = true;
    }

    /**
     * 把 API 异常压成表单可显示文案。
     */
    function errorMessage(error: unknown, fallback: string): string {
        return resolveApiErrorMessage(error, fallback);
    }

    return {user, loaded, authEnabled, refresh, logout, errorMessage};
}

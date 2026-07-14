import {useAuthState} from "../composables/useAuthState";

/**
 * 登录开启时保护检测工作台；登录关闭时 `/api/auth/me` 会返回稳定的本地开发身份，直接放行。
 */
export default defineNuxtRouteMiddleware(async (to) => {
    if (to.path !== "/contribute") {
        return;
    }
    const auth = useAuthState();
    const user = auth.loaded.value ? auth.user.value : await auth.refresh();
    if (auth.authEnabled.value && !user) {
        return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
    }
});

import {getCurrentUser} from "../utils/auth";

const publicApiPaths = new Set([
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/auth/register",
    "/api/_auth/session",
]);

const protectedWriteApiPaths = new Set([
    "/api/texts",
    "/api/judgments",
    "/api/scans",
    "/api/annotations",
    "/api/export",
]);

/**
 * 判断当前路径是否是静态资源或公开 API。
 */
function isPublicPath(pathname: string): boolean {
    if (publicApiPaths.has(pathname)) {
        return true;
    }
    if (pathname.startsWith("/_nuxt/") || pathname.startsWith("/__nuxt")) {
        return true;
    }
    if (pathname === "/favicon.ico" || pathname === "/robots.txt") {
        return true;
    }
    return /\.(?:css|js|mjs|map|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i.test(pathname);
}

/**
 * 判断当前请求是否需要登录。
 */
function requiresAuth(pathname: string): boolean {
    return pathname === "/contribute" || protectedWriteApiPaths.has(pathname);
}

/**
 * 采集站鉴权守卫：默认公开，只 gate contribute 页面与写库 API。
 */
export default defineEventHandler(async (event) => {
    const url = getRequestURL(event);
    const pathname = url.pathname;
    if (isPublicPath(pathname) || !requiresAuth(pathname)) {
        return;
    }

    const user = await getCurrentUser(event);
    if (user) {
        return;
    }

    if (pathname.startsWith("/api/")) {
        throw createError({
            statusCode: 401,
            message: "请先登录",
        });
    }

    const redirectTarget = `${url.pathname}${url.search}`;
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(redirectTarget)}`, 302);
});

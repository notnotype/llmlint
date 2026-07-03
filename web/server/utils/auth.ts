import type {H3Event} from "h3";
import {getRequestProtocol} from "h3";
import type {User} from "../database/prisma";
import {prisma} from "../database/prisma";

export type AuthUserDto = {
    id: string;
    username: string;
    displayName: string;
    role: "admin" | "user";
    identityRole: "reader" | "writer" | "editor" | "pro";
    sessionVersion: number;
};

export type AuthSessionDto = {
    authEnabled: true;
    user: AuthUserDto | null;
};

/**
 * 根据当前请求协议生成 session 配置。HTTP dev 站点不能使用 Secure cookie。
 */
function authSessionConfig(event: H3Event) {
    return {
        cookie: {
            secure: getRequestProtocol(event) === "https",
            sameSite: "lax" as const,
        },
    };
}

/**
 * 写入当前用户 session。
 */
export async function setAuthSession(event: H3Event, user: AuthUserDto): Promise<void> {
    await setUserSession(event, {user}, authSessionConfig(event));
}

/**
 * 清理当前用户 session。
 */
export async function clearAuthSession(event: H3Event): Promise<void> {
    await clearUserSession(event, authSessionConfig(event));
}

/**
 * 将用户实体映射为可写入 session 的轻量身份。
 */
export function toAuthUser(user: Pick<User, "id" | "username" | "displayName" | "role" | "identityRole" | "sessionVersion">): AuthUserDto {
    return {
        id: String(user.id),
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        identityRole: user.identityRole,
        sessionVersion: user.sessionVersion,
    };
}

/**
 * 获取当前请求的有效用户。
 */
export async function getCurrentUser(event: H3Event): Promise<User | null> {
    const session = await getUserSession(event);
    const sessionUser = session.user as Partial<AuthUserDto> | undefined;
    const sessionUserId = sessionUser?.id;
    if (!sessionUserId) {
        return null;
    }

    const userId = Number.parseInt(sessionUserId, 10);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        await clearAuthSession(event);
        return null;
    }

    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user || user.status !== "active" || user.sessionVersion !== sessionUser?.sessionVersion) {
        await clearAuthSession(event);
        return null;
    }

    return user;
}

/**
 * 要求当前请求来自已登录用户。
 */
export async function requireCurrentUser(event: H3Event): Promise<User> {
    const user = await getCurrentUser(event);
    if (!user) {
        throw createError({
            statusCode: 401,
            message: "请先登录",
        });
    }
    return user;
}

/**
 * 要求当前请求来自管理员。
 */
export async function requireAdmin(event: H3Event): Promise<User> {
    const user = await requireCurrentUser(event);
    if (user.role !== "admin") {
        throw createError({
            statusCode: 403,
            message: "需要管理员权限",
        });
    }
    return user;
}

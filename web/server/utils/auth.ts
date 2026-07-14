import type {H3Event} from "h3";
import {getRequestProtocol} from "h3";
import {randomUUID} from "node:crypto";
import type {User} from "../database/prisma";
import {prisma} from "../database/prisma";
import {hashUserPassword} from "./password";
import {resolveAuthEnabled} from "./auth-mode";

export type AuthUserDto = {
    id: string;
    username: string;
    displayName: string;
    role: "admin" | "user";
    identityRole: "reader" | "writer" | "editor" | "pro";
    sessionVersion: number;
};

export type AuthSessionDto = {
    authEnabled: boolean;
    user: AuthUserDto | null;
};

const DEVELOPMENT_USERNAME = "__llmlint_local_development__";
let developmentUserPromise: Promise<User> | null = null;

/**
 * 判断当前部署是否启用登录。
 */
export function isAuthEnabled(event: H3Event): boolean {
    // 默认值同时让尚未由 Nuxt prepare 刷新的本地生成类型保持可检查；运行时 config 会覆盖它。
    const config = {...{authEnabled: process.env.NODE_ENV === "production"}, ...useRuntimeConfig(event)};
    return resolveAuthEnabled(config.authEnabled);
}

/**
 * 登录、注册等账号端点只在鉴权开启时可用。
 */
export function requireAuthEnabled(event: H3Event): void {
    if (!isAuthEnabled(event)) {
        throw createError({statusCode: 409, message: "当前环境已关闭登录"});
    }
}

/**
 * 登录关闭时解析稳定的本地开发身份。所有请求共享同一用户，避免 Cookie、主机名切换或 dev server
 * 重启让异步 job 的创建者和轮询者变成不同身份。该用户保持普通 user 角色，不绕过 admin 权限。
 */
async function getDevelopmentUser(): Promise<User> {
    developmentUserPromise ??= (async () => {
        const existing = await prisma.user.findUnique({where: {username: DEVELOPMENT_USERNAME}});
        if (existing) {
            if (existing.status === "active") {
                return existing;
            }
            return prisma.user.update({where: {id: existing.id}, data: {status: "active"}});
        }
        return prisma.user.create({
            data: {
                username: DEVELOPMENT_USERNAME,
                displayName: "Local Development",
                passwordHash: await hashUserPassword(randomUUID()),
            },
        });
    })();
    try {
        return await developmentUserPromise;
    } catch (error) {
        developmentUserPromise = null;
        throw error;
    }
}

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
    if (!isAuthEnabled(event)) {
        return getDevelopmentUser();
    }
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

import {randomUUID} from "node:crypto";
import {Prisma, prisma} from "../database/prisma";
import type {User} from "../database/prisma";
import {hashUserPassword} from "./password";

export type NeuroBookUserInfo = {
    id: number;
    username: string;
    displayName: string;
    status: "active";
};

function configuredAdminUserId(): number | null {
    const raw = useRuntimeConfig().neuroBookAdminUserId;
    const value = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function throwAccountError(statusCode: number, error: string, message: string): never {
    throw createError({statusCode, message, data: {error}});
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function updateMappedUser(user: User, info: NeuroBookUserInfo): Promise<User> {
    if (user.status !== "active") {
        throwAccountError(403, "account_disabled", "The linked llmlint account is disabled");
    }
    return prisma.user.update({
        where: {id: user.id},
        data: {displayName: info.displayName, lastLoginAt: new Date()},
    });
}

/**
 * 把官方 User.id 映射到 llmlint 自有 User.id；只更新同一映射行，不移动任何评分外键。
 */
export async function resolveNeuroBookUser(info: NeuroBookUserInfo): Promise<User> {
    const mapped = await prisma.user.findUnique({where: {neuroBookUserId: info.id}});
    if (mapped) {
        return updateMappedUser(mapped, info);
    }

    const usernameConflict = await prisma.user.findUnique({
        where: {username: info.username},
        select: {id: true},
    });
    if (usernameConflict) {
        throwAccountError(409, "account_mapping_conflict", "The official username is already used locally");
    }

    const role = info.id === configuredAdminUserId() ? "admin" : "user";
    try {
        return await prisma.user.create({
            data: {
                neuroBookUserId: info.id,
                username: info.username,
                displayName: info.displayName,
                passwordHash: await hashUserPassword(randomUUID()),
                role,
                identityRole: "reader",
                status: "active",
                lastLoginAt: new Date(),
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) {
            throw error;
        }
        // 只接受同一 official id 的并发胜者；username 唯一冲突不自动合并。
        const concurrent = await prisma.user.findUnique({where: {neuroBookUserId: info.id}});
        if (!concurrent) {
            throw error;
        }
        return updateMappedUser(concurrent, info);
    }
}

import {PrismaLibSql} from "@prisma/adapter-libsql";
import "@libsql/isomorphic-ws";
import {Prisma, PrismaClient} from "../generated/prisma/client";

export type {PrismaClient};
export {Prisma};
export type {
    ClassificationSource,
    IdentityRole,
    OriginKind,
    Provenance,
    TransitionKind,
    User,
    UserRole,
    UserStatus,
    Visibility,
} from "../generated/prisma/client";

type GlobalPrisma = {
    prismaClient?: PrismaClient;
};

const globalForPrisma = globalThis as typeof globalThis & GlobalPrisma;

/**
 * 解析 llmlint web 的本地 SQLite URL。
 */
function resolveDatabaseUrl(): string {
    const url = process.env.DATABASE_URL?.trim() || "file:./data.db";
    if (!url.startsWith("file:")) {
        throw new Error(`llmlint web 只支持 file: SQLite URL，当前为：${url}`);
    }
    return url;
}

/**
 * 创建 libSQL 适配器 PrismaClient。
 */
export function createPrismaClient(url = resolveDatabaseUrl()): PrismaClient {
    const adapter = new PrismaLibSql({url});
    return new PrismaClient({adapter});
}

/**
 * 获取进程级 PrismaClient 单例。
 */
export function usePrismaClient(): PrismaClient {
    if (!globalForPrisma.prismaClient) {
        globalForPrisma.prismaClient = createPrismaClient();
    }
    return globalForPrisma.prismaClient;
}

/**
 * API 处理器中直接复用的 Prisma 实例。
 */
export const prisma = usePrismaClient();

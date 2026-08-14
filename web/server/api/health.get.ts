import {prisma} from "../database/prisma";

/** 无认证健康检查：只返回服务状态，不把数据库连接错误细节暴露给客户端。 */
export default defineEventHandler(async () => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return {status: "ok", service: "llmlint-web", database: "ok"} as const;
    } catch {
        throw createError({statusCode: 503, message: "数据库暂不可用"});
    }
});

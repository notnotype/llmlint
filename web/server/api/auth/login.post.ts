import type {AuthSessionDto} from "../../utils/auth";
import {requireAuthEnabled, setAuthSession, toAuthUser} from "../../utils/auth";
import {LoginRequestDtoSchema, validateBody} from "../../utils/dto";
import {verifyUserPassword} from "../../utils/password";
import {prisma} from "../../database/prisma";

/**
 * 登录并写入 session。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    requireAuthEnabled(event);
    const body = await validateBody(event, LoginRequestDtoSchema);
    const user = await prisma.user.findUnique({
        where: {username: body.username},
    });
    const passwordMatched = user?.status === "active"
        ? await verifyUserPassword(body.password, user.passwordHash)
        : false;

    if (!user || user.status !== "active" || !passwordMatched) {
        throw createError({
            statusCode: 401,
            message: "用户名或密码错误",
        });
    }

    const updatedUser = await prisma.user.update({
        where: {id: user.id},
        data: {lastLoginAt: new Date()},
    });
    const sessionUser = toAuthUser(updatedUser);
    await setAuthSession(event, sessionUser);

    return {authEnabled: true, user: sessionUser};
});

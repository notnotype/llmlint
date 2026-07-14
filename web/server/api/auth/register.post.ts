import type {AuthSessionDto} from "../../utils/auth";
import {requireAuthEnabled, setAuthSession, toAuthUser} from "../../utils/auth";
import {RegisterRequestDtoSchema, validateBody} from "../../utils/dto";
import {hashUserPassword} from "../../utils/password";
import {prisma} from "../../database/prisma";

/**
 * 自助注册普通用户，并立即写入 session。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    requireAuthEnabled(event);
    const body = await validateBody(event, RegisterRequestDtoSchema);
    const existing = await prisma.user.findUnique({
        where: {username: body.username},
        select: {id: true},
    });
    if (existing) {
        throw createError({
            statusCode: 409,
            message: "用户名已存在",
        });
    }

    const user = await prisma.user.create({
        data: {
            username: body.username,
            displayName: body.username,
            passwordHash: await hashUserPassword(body.password),
            identityRole: body.identityRole,
        },
    });
    const sessionUser = toAuthUser(user);
    await setAuthSession(event, sessionUser);

    return {authEnabled: true, user: sessionUser};
});

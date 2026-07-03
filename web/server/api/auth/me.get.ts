import type {AuthSessionDto} from "../../utils/auth";
import {getCurrentUser, toAuthUser} from "../../utils/auth";

/**
 * 返回当前 session 对应的有效用户。
 */
export default defineEventHandler(async (event): Promise<AuthSessionDto> => {
    const user = await getCurrentUser(event);
    return {
        authEnabled: true,
        user: user ? toAuthUser(user) : null,
    };
});

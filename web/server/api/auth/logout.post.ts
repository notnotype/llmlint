import {clearAuthSession, isAuthEnabled} from "../../utils/auth";

/**
 * 清理当前登录 session。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    if (isAuthEnabled(event)) {
        await clearAuthSession(event);
    }
    return {ok: true};
});

import {getRequestURL, isError, sendRedirect} from "h3";
import {consumePendingNeuroBookOAuthSession, setAuthSession, toAuthUser} from "../../utils/auth";
import {exchangeNeuroBookAuthorizationCode, fetchNeuroBookUserInfo, neuroBookOAuthSettings} from "../../utils/neurobook-oauth";
import {resolveNeuroBookUser} from "../../utils/neurobook-user";

const PENDING_TTL_MS = 10 * 60 * 1000;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/u;

function isMappingConflict(error: unknown): boolean {
    if (!isError<{error?: string}>(error)) {
        return false;
    }
    return error.data?.error === "account_mapping_conflict";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRedirectTarget(value: string): boolean {
    return value.startsWith("/") && !value.startsWith("//");
}

function loginFailure(error: "sso_failed" | "account_mapping_conflict"): string {
    return `/login?error=${error}`;
}

function validateUserInfo(value: unknown): {id: number; username: string; displayName: string; status: "active"} | null {
    if (!isRecord(value) || typeof value.sub !== "string" || typeof value.id !== "number"
        || !Number.isSafeInteger(value.id) || value.id <= 0
        || value.sub !== String(value.id)
        || typeof value.username !== "string" || !USERNAME_PATTERN.test(value.username)
        || typeof value.displayName !== "string" || value.displayName.length > 200
        || value.status !== "active") {
        return null;
    }
    return {
        id: value.id,
        username: value.username,
        displayName: value.displayName,
        status: "active",
    };
}

/** NeuroBook callback：一次性消费 pending，兑换短时 token，只调用一次 userinfo 后建立本地 session。 */
export default defineEventHandler(async (event) => {
    const pending = await consumePendingNeuroBookOAuthSession(event);
    if (!pending || Date.now() - pending.createdAt < 0 || Date.now() - pending.createdAt > PENDING_TTL_MS
        || !isSafeRedirectTarget(pending.redirectTarget)) {
        return sendRedirect(event, loginFailure("sso_failed"), 302);
    }

    try {
        const settings = neuroBookOAuthSettings();
        const callbackUrl = new URL(settings.redirectUri);
        callbackUrl.search = getRequestURL(event).search;
        const accessToken = await exchangeNeuroBookAuthorizationCode(callbackUrl, pending.state, pending.codeVerifier);
        const userInfo = validateUserInfo(await fetchNeuroBookUserInfo(accessToken));
        if (!userInfo) {
            throw new Error("NeuroBook userinfo contract is invalid");
        }
        const localUser = await resolveNeuroBookUser(userInfo);
        await setAuthSession(event, toAuthUser(localUser));
        return sendRedirect(event, pending.redirectTarget, 302);
    } catch (error) {
        return sendRedirect(event, loginFailure(isMappingConflict(error) ? "account_mapping_conflict" : "sso_failed"), 302);
    }
});

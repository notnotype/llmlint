import {getQuery, sendRedirect} from "h3";
import {isNeuroBookOAuthEnabled, setPendingNeuroBookOAuthSession} from "../../../utils/auth";
import {createNeuroBookAuthorizationRequest} from "../../../utils/neurobook-oauth";

function safeRedirectTarget(value: unknown): string {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
        return "/contribute";
    }
    return value;
}

/** 发起 NeuroBook Authorization Code + S256 PKCE；未启用时不降级密码登录。 */
export default defineEventHandler(async (event) => {
    if (!isNeuroBookOAuthEnabled(event)) {
        throw createError({statusCode: 503, message: "NeuroBook SSO is unavailable", data: {error: "sso_unavailable"}});
    }
    const query = getQuery(event);
    const redirectTarget = safeRedirectTarget(query.redirect);
    const request = await createNeuroBookAuthorizationRequest();
    await setPendingNeuroBookOAuthSession(event, {
        provider: "neuro-book",
        state: request.state,
        codeVerifier: request.codeVerifier,
        redirectTarget,
        createdAt: Date.now(),
    });
    return sendRedirect(event, request.authorizationUrl.toString(), 302);
});

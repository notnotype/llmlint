import {
    allowInsecureRequests,
    authorizationCodeGrant,
    buildAuthorizationUrl,
    calculatePKCECodeChallenge,
    ClientSecretBasic,
    discovery,
    fetchUserInfo,
    randomPKCECodeVerifier,
    randomState,
    skipSubjectCheck,
    type Configuration,
} from "openid-client";

export type NeuroBookOAuthSettings = {
    enabled: boolean;
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
};

let configurationPromise: Promise<Configuration> | null = null;

function runtimeFlag(value: boolean | string | undefined): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    return !["0", "false", "off"].includes((value ?? "").trim().toLowerCase());
}

/** 读取声明过的 Nuxt runtimeConfig；不直接从未声明环境变量取 OAuth secret。 */
export function neuroBookOAuthSettings(): NeuroBookOAuthSettings {
    const config = useRuntimeConfig();
    return {
        enabled: runtimeFlag(config.neuroBookOAuthEnabled),
        issuer: String(config.neuroBookOAuthIssuer ?? "").trim().replace(/\/$/u, ""),
        clientId: String(config.neuroBookOAuthClientId ?? "").trim(),
        clientSecret: String(config.neuroBookOAuthClientSecret ?? ""),
        redirectUri: String(config.neuroBookOAuthRedirectUri ?? "").trim(),
    };
}

/**
 * 按进程缓存 OAuth metadata；只在 start/callback 首次需要时联网，失败后清空允许下一次重试。
 */
export async function getNeuroBookOAuthConfiguration(): Promise<Configuration> {
    if (!configurationPromise) {
        configurationPromise = createConfiguration();
    }
    try {
        return await configurationPromise;
    } catch (error) {
        configurationPromise = null;
        throw error;
    }
}

async function createConfiguration(): Promise<Configuration> {
    const settings = neuroBookOAuthSettings();
    if (!settings.enabled || !settings.issuer || !settings.clientId || !settings.clientSecret || !settings.redirectUri) {
        throw new Error("NeuroBook OAuth configuration is incomplete");
    }
    const issuer = new URL(settings.issuer);
    const options = issuer.protocol === "http:"
        ? {algorithm: "oauth2" as const, execute: [allowInsecureRequests]}
        : {algorithm: "oauth2" as const};
    return discovery(
        issuer,
        settings.clientId,
        undefined,
        ClientSecretBasic(settings.clientSecret),
        options,
    );
}

/** 生成 S256 授权 URL 所需的 verifier、challenge、state。 */
export async function createNeuroBookAuthorizationRequest(): Promise<{
    authorizationUrl: URL;
    state: string;
    codeVerifier: string;
}> {
    const settings = neuroBookOAuthSettings();
    const configuration = await getNeuroBookOAuthConfiguration();
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomState();
    const authorizationUrl = buildAuthorizationUrl(configuration, {
        response_type: "code",
        client_id: settings.clientId,
        redirect_uri: settings.redirectUri,
        scope: "profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
    });
    return {authorizationUrl, state, codeVerifier};
}

/** 用一次性 callback URL 兑换 code；不使用 refresh token 或 ID token。 */
export async function exchangeNeuroBookAuthorizationCode(
    callbackUrl: URL,
    state: string,
    codeVerifier: string,
): Promise<string> {
    const configuration = await getNeuroBookOAuthConfiguration();
    const tokens = await authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: state,
        pkceCodeVerifier: codeVerifier,
    });
    if (!tokens.access_token) {
        throw new Error("NeuroBook OAuth response did not contain an access token");
    }
    return tokens.access_token;
}

/** 唯一一次 userinfo 调用；sub 校验由 callback 自己完成。 */
export async function fetchNeuroBookUserInfo(accessToken: string): Promise<unknown> {
    const configuration = await getNeuroBookOAuthConfiguration();
    return fetchUserInfo(configuration, accessToken, skipSubjectCheck);
}

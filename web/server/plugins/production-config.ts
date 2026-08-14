import {defineNitroPlugin} from "nitropack/runtime";
import {neuroBookOAuthSettings} from "../utils/neurobook-oauth";

const EXPECTED_ISSUER = "https://nbook.notnotype.com";
const EXPECTED_CLIENT_ID = "llmlint-web";
const EXPECTED_REDIRECT_URI = "https://llmlint.notnotype.com/auth/neurobook";

function positiveInteger(value: unknown): boolean {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    return Number.isSafeInteger(parsed) && parsed > 0;
}

/** 生产 SSO 配置门禁；任何缺失或错误值都在监听业务流量前 fail closed。 */
export default defineNitroPlugin(() => {
    // 不能直接用 `process.env.NODE_ENV`：Nitro 构建会把它常量折叠，导致 dev smoke
    // 运行时也执行生产门禁。Reflect.get 保留真正部署进程的运行时值。
    const nodeEnv = Reflect.get(process.env, "NODE_ENV");
    if (nodeEnv !== "production") {
        return;
    }
    const settings = neuroBookOAuthSettings();
    const config = useRuntimeConfig();
    const errors: string[] = [];
    if (!settings.enabled) {
        errors.push("NUXT_NEUROBOOK_OAUTH_ENABLED 必须开启");
    }
    if (settings.issuer !== EXPECTED_ISSUER) {
        errors.push("NUXT_NEUROBOOK_OAUTH_ISSUER 必须精确为官方 HTTPS issuer");
    }
    if (settings.clientId !== EXPECTED_CLIENT_ID) {
        errors.push("NUXT_NEUROBOOK_OAUTH_CLIENT_ID 必须为 llmlint-web");
    }
    if (settings.clientSecret.length < 32 || /replace|change|example|secret/i.test(settings.clientSecret)) {
        errors.push("NUXT_NEUROBOOK_OAUTH_CLIENT_SECRET 必须是至少 32 字符的非示例 secret");
    }
    if (settings.redirectUri !== EXPECTED_REDIRECT_URI) {
        errors.push("NUXT_NEUROBOOK_OAUTH_REDIRECT_URI 必须精确匹配 callback URI");
    }
    if (!positiveInteger(config.neuroBookAdminUserId)) {
        errors.push("NUXT_NEUROBOOK_ADMIN_USER_ID 必须是正安全整数");
    }
    if (process.env.NUXT_ADMIN_USERNAME !== undefined || process.env.NUXT_ADMIN_PASSWORD !== undefined) {
        errors.push("生产环境禁止旧 NUXT_ADMIN_USERNAME/NUXT_ADMIN_PASSWORD");
    }
    if (errors.length > 0) {
        throw new Error(`NeuroBook SSO 生产配置无效：\n- ${errors.join("\n- ")}`);
    }
});

export type AuthEnabledValue = boolean | string;

/**
 * 解析 Nuxt runtimeConfig 的登录开关。
 * 环境变量在不同部署器中可能以字符串注入，因此在鉴权边界统一归一化。
 */
export function resolveAuthEnabled(value: AuthEnabledValue): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    return !["0", "false", "off"].includes(value.trim().toLowerCase());
}

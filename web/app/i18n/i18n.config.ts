import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

declare const defineI18nConfig: <T>(factory: () => T) => T;

export default defineI18nConfig(() => ({
    legacy: false,
    locale: "zh-CN",
    fallbackLocale: "zh-CN",
    messages: {
        "zh-CN": zhCN,
        "en-US": enUS,
    },
}));

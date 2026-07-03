import {computed} from "vue";
import {messages, type MessageKey} from "../i18n/messages";
import {useWebSettings} from "./useWebSettings";

/** llmlint Web 的轻量 i18n。当前不改 URL，只随浏览器设置切换。 */
export function useLlmlintI18n() {
    const {settings} = useWebSettings();
    const locale = computed(() => settings.value.locale);

    function t(key: MessageKey, params: Record<string, string | number> = {}): string {
        const template = messages[locale.value][key] ?? messages["zh-CN"][key] ?? key;
        return Object.entries(params).reduce(
            (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
            template,
        );
    }

    return {locale, t};
}

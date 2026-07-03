import {computed, onBeforeUnmount, watch} from "vue";
import {applyThemeVars} from "../utils/theme/apply-theme";
import {LLMLINT_THEME_HOST_CLASS, themeTokens, type LlmlintTheme, type ResolvedLlmlintTheme} from "../utils/theme/theme-tokens";
import {useWebSettings} from "./useWebSettings";

const themeHost = shallowRef<HTMLElement | null>(null);

function systemTheme(): ResolvedLlmlintTheme {
    if (!import.meta.client) {
        return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: LlmlintTheme): ResolvedLlmlintTheme {
    return theme === "system" ? systemTheme() : theme;
}

function applyTheme(theme: LlmlintTheme): void {
    const host = themeHost.value;
    if (!host) {
        return;
    }
    const resolved = resolveTheme(theme);
    host.classList.add(LLMLINT_THEME_HOST_CLASS);
    host.dataset.theme = resolved;
    applyThemeVars(host, themeTokens[resolved]);
}

/** 将 llmlint 主题变量挂到页面宿主，同时同步 Nuxt color-mode 的 dark class。 */
export function useLlmlintTheme() {
    const {settings, patch} = useWebSettings();
    const colorMode = useColorMode();
    const resolvedTheme = computed(() => resolveTheme(settings.value.theme));

    function syncColorMode(): void {
        colorMode.preference = resolvedTheme.value === "dark" ? "dark" : "light";
    }

    function mountThemeHost(host: HTMLElement | null): void {
        themeHost.value = host;
        applyTheme(settings.value.theme);
        syncColorMode();
    }

    function setTheme(theme: LlmlintTheme): void {
        patch({theme});
        applyTheme(theme);
        syncColorMode();
    }

    watch(() => settings.value.theme, (nextTheme) => {
        applyTheme(nextTheme);
        syncColorMode();
    });

    let media: MediaQueryList | null = null;
    const onSystemChange = (): void => {
        if (settings.value.theme === "system") {
            applyTheme(settings.value.theme);
            syncColorMode();
        }
    };

    if (import.meta.client) {
        media = window.matchMedia("(prefers-color-scheme: dark)");
        media.addEventListener("change", onSystemChange);
    }

    onBeforeUnmount(() => {
        media?.removeEventListener("change", onSystemChange);
    });

    return {resolvedTheme, mountThemeHost, setTheme};
}

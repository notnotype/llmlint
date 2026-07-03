import type {ThemeVars} from "./theme-tokens";
import {themeVarKeys} from "./theme-tokens";

/** 清理主题宿主上的全部 llmlint 主题变量。 */
export function clearThemeVars(host: HTMLElement): void {
    for (const key of themeVarKeys) {
        host.style.removeProperty(key);
    }
}

/** 将主题变量写入宿主节点，组件只消费 CSS 变量。 */
export function applyThemeVars(host: HTMLElement, vars: ThemeVars): void {
    clearThemeVars(host);
    for (const [key, value] of Object.entries(vars) as Array<[`--${string}`, string]>) {
        host.style.setProperty(key, value);
    }
}

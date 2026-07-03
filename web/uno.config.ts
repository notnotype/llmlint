import {defineConfig, presetUno, presetIcons} from "unocss";

export default defineConfig({
    presets: [
        presetUno(),
        // presetIcons 会按 `i-lucide-*` 自动从 @iconify-json/lucide 取图标数据。
        presetIcons(),
    ],
    // safelist 本项目实际用到的 lucide 图标（动态 :class 绑定的图标 UnoCSS 静态扫不到）。
    safelist: [
        "file-text",
        "sun",
        "moon",
        "chevron-down",
        "chevron-right",
        "info",
        "check-circle-2",
        "trash-2",
        "bot",
        "sparkles",
        "copy",
        "x",
        "settings",
        "rotate-ccw",
        "monitor-cog",
        "scan-text",
        "flame",
        "heart",
        "history",
        "sliders-horizontal",
    ].map((name) => `i-lucide-${name}`),
    theme: {
        colors: {
            level: {
                high: "#dc2626",
                medium: "#d97706",
                low: "#6b7280",
            },
        },
    },
});

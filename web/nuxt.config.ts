import {fileURLToPath} from "node:url";

// llmlint 检测页：客户端检测 + Nitro API 采集站。
// - ssr:false 保留，检测逻辑继续只在浏览器本地运行。
// - Nitro server/api 负责认证、判定标签采集与导出，部署形态从纯静态改为单 Node 应用。
// - alias `llmlint` 指向 sibling `../skill/src`，直接复用引擎的纯函数（scanText / computeMaskedRanges）。
// - vite.server.fs.allow 放开仓库根，dev 时允许 import 出 web/ 目录外的 skill 源码。
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skillSrc = fileURLToPath(new URL("../skill/src", import.meta.url));
// 评测报告页只需 evals 的 Report 类型契约（纯 import type，构建期擦除，无运行时耦合）。
const evalsLib = fileURLToPath(new URL("../evals/lib", import.meta.url));

export default defineNuxtConfig({
    ssr: false,
    devtools: {enabled: process.env.NUXT_DEVTOOLS === "1"},
    compatibilityDate: "2026-07-01",
    modules: ["@unocss/nuxt", "@nuxtjs/color-mode", "nuxt-auth-utils"],
    colorMode: {classSuffix: ""},
    css: ["@unocss/reset/tailwind.css"],
    alias: {
        llmlint: skillSrc,
        evals: evalsLib,
    },
    vite: {
        server: {
            fs: {allow: [repoRoot]},
        },
    },
    app: {
        // GitHub Pages 项目页需 baseURL="/llmlint/"（CI 传 NUXT_APP_BASE_URL）；根路径/自有域名默认 "/"。
        baseURL: process.env.NUXT_APP_BASE_URL ?? "/",
        head: {
            title: "llmlint — 中文 AI 味检测",
            htmlAttrs: {lang: "zh-CN"},
            meta: [
                {name: "viewport", content: "width=device-width, initial-scale=1"},
                {name: "description", content: "llmlint：中文 AI 味检测器与判定标签采集站。检测在浏览器本地运行，贡献流程登录后落库。"},
                {property: "og:title", content: "llmlint — 中文 AI 味检测"},
                {property: "og:description", content: "浏览器本地检测中文文本里的 AI 写作痕迹，并支持注册用户贡献盲评判定标签。"},
                {property: "og:type", content: "website"},
            ],
            link: [
                // 内联 SVG favicon（琥珀底 + 白色 L），无需额外文件。
                {rel: "icon", type: "image/svg+xml", href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23f59e0b'/%3E%3Ctext x='16' y='23' font-family='monospace' font-size='20' font-weight='bold' text-anchor='middle' fill='white'%3EL%3C/text%3E%3C/svg%3E"},
            ],
        },
    },
});

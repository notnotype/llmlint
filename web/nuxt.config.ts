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
// W6 分类通道在服务端运行时复用 evals 的分类 agent 与模型客户端。`evals` alias 已被
// app 侧按 evals/lib 语义消费，classifier/generator 是 lib 的兄弟目录，用独立 alias 指过去。
const evalsClassifier = fileURLToPath(new URL("../evals/classifier", import.meta.url));
const evalsGenerator = fileURLToPath(new URL("../evals/generator", import.meta.url));
// W3 检测器通道复用 evals/detector 的句界分块纯函数（chunkBySentence/visibleLen，落库口径单源）。
const evalsDetector = fileURLToPath(new URL("../evals/detector", import.meta.url));
// W3 代理 fetch：nitro 自带别名 `node-fetch-native` → `node-fetch-native/native`，会把子路径
// `node-fetch-native/proxy` 错误改写成 `…/native.mjs/proxy` → 用独立别名直指 node 实现文件绕开
// （类型经 shared/vendor-compat.d.ts 的 re-export 声明补齐）。
const nodeFetchNativeProxy = fileURLToPath(new URL("./node_modules/node-fetch-native/dist/proxy.cjs", import.meta.url));

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
        "evals-classifier": evalsClassifier,
        "evals-generator": evalsGenerator,
        "evals-detector": evalsDetector,
        "node-fetch-native-proxy": nodeFetchNativeProxy,
    },
    runtimeConfig: {
        // 登录开关：开发环境默认关闭，生产构建默认开启。运行时可用 NUXT_AUTH_ENABLED=true/false 覆盖。
        // 关闭时所有请求统一映射到本地开发用户，不依赖 Cookie，因此异步任务轮询不会因 session 丢失返回 401。
        authEnabled: process.env.NODE_ENV === "production",
        // W6：eval 配置文件绝对路径（构建期按仓根解析；运行期可用 NUXT_EVAL_CONFIG_PATH 覆盖）。
        // 服务端 LLM 分类通道读它的 classifier/modelsConfig 链；文件或对应节缺失时通道自动禁用。
        evalConfigPath: fileURLToPath(new URL("../evals/eval.config.json", import.meta.url)),
        // W9-B：admin 引导种子（server/plugins/admin-seed.ts）。Nuxt 惯例路径：这里声明空串默认，
        // 运行期由环境变量 NUXT_ADMIN_USERNAME / NUXT_ADMIN_PASSWORD 覆盖（放 gitignored 的 .env，
        // 密码绝不进任何入 git 文件）；两者缺任一 → 启动时跳过种子，零副作用。
        adminUsername: "",
        adminPassword: "",
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
                {name: "description", content: "llmlint：中文 AI 味检测器与判定标签采集站。检测在浏览器本地运行，五步贡献流程免登录（内网信任模式）。"},
                {property: "og:title", content: "llmlint — 中文 AI 味检测"},
                {property: "og:description", content: "浏览器本地检测中文文本里的 AI 写作痕迹，并支持免登录贡献盲评判定标签。"},
                {property: "og:type", content: "website"},
            ],
            link: [
                // 内联 SVG favicon（琥珀底 + 白色 L），无需额外文件。
                {rel: "icon", type: "image/svg+xml", href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23f59e0b'/%3E%3Ctext x='16' y='23' font-family='monospace' font-size='20' font-weight='bold' text-anchor='middle' fill='white'%3EL%3C/text%3E%3C/svg%3E"},
            ],
        },
    },
});

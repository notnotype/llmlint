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
    nitro: {
        preset: "node-server",
        externals: {
            external: [
                "typescript",
                "@earendil-works/pi-ai",
                "@notnotype/neuro-agent-harness",
                "@google/genai",
                "@anthropic-ai/sdk",
                "@mistralai/mistralai",
                "openai",
                "@gradio/client",
            ],
        },
        rollupConfig: {
            // 服务端 AST 校验从生产 node_modules 加载 TypeScript，避免把编译器内联进 Nitro 单文件。
            external: ["typescript"],
            plugins: [
                {
                    // Prisma 生成 client 顶层的 __dirname polyfill 在 bundle 后拿到 Nitro
                    // 虚拟入口 URL（file:///_entry.js），Windows 的 fileURLToPath 会直接抛错。
                    // driver adapter（libsql）不依赖该路径定位引擎，兜底到工作目录即可。
                    name: "patch-prisma-generated-dirname",
                    transform(code: string, id: string) {
                        if (!id.replaceAll("\\", "/").includes("/server/generated/prisma/client")) {
                            return null;
                        }
                        const pattern = /globalThis\[["']__dirname["']\]\s*=\s*path\.dirname\(fileURLToPath\([^)]*\)\)/;
                        if (!pattern.test(code)) {
                            return null;
                        }
                        return code.replace(pattern, (line) => `try { ${line} } catch { globalThis["__dirname"] = process.cwd() }`);
                    },
                },
            ],
        },
    },
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
        // 登录开关：开发环境默认关闭；生产由部署环境显式开启并配合 NeuroBook SSO。
        // 关闭时所有请求统一映射到本地开发用户，不依赖 Cookie，因此本地异步任务轮询不会丢身份。
        authEnabled: process.env.NODE_ENV === "production",
        session: {
            name: "llmlint-session",
            password: "",
        },
        neuroBookOAuthEnabled: false,
        neuroBookOAuthIssuer: "",
        neuroBookOAuthClientId: "",
        neuroBookOAuthClientSecret: "",
        neuroBookOAuthRedirectUri: "",
        neuroBookAdminUserId: "",
        // W6：eval 配置文件由部署环境注入绝对路径；默认值仅用于本地开发。
        // 生产 systemd 必须设置 NUXT_EVAL_CONFIG_PATH，避免把 Windows 构建机路径烘进 Node 产物。
        evalConfigPath: process.env.NUXT_EVAL_CONFIG_PATH ?? "",
    },
    vite: {
        server: {
            fs: {allow: [repoRoot]},
        },
    },
    app: {
        // 正式 origin 使用根路径；Node 服务不再为 GitHub Pages 设置项目子路径。
        baseURL: "/",
        head: {
            title: "llmlint — 中文 AI 味检测",
            htmlAttrs: {lang: "zh-CN"},
            meta: [
                {name: "viewport", content: "width=device-width, initial-scale=1"},
                {name: "description", content: "llmlint：中文 AI 味检测器与判定标签采集站。检测在浏览器本地运行，生产登录使用 NeuroBook 官方账号。"},
                {property: "og:title", content: "llmlint — 中文 AI 味检测"},
                {property: "og:description", content: "浏览器本地检测中文文本里的 AI 写作痕迹，并支持登录后参与盲评。"},
                {property: "og:type", content: "website"},
            ],
            link: [
                // 内联 SVG favicon（琥珀底 + 白色 L），无需额外文件。
                {rel: "icon", type: "image/svg+xml", href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23f59e0b'/%3E%3Ctext x='16' y='23' font-family='monospace' font-size='20' font-weight='bold' text-anchor='middle' fill='white'%3EL%3C/text%3E%3C/svg%3E"},
            ],
        },
    },
});

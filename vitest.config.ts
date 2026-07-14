// vitest 根配置（Task 18 首建）：tests/ 里要测 web/server/utils/llm-fix-agent.ts，
// 它经 nuxt 的 "evals-generator" alias 引 evals 侧代码——vitest 不认 nuxt alias，这里补同一映射。
// include 保持默认（tests/**），既有测试行为不变。
import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";

export default defineConfig({
    test: {
        // 只收 tests/（evals/ 下是 bun:test，混进来会因 bun:test 导入失败）。
        include: ["tests/**/*.test.ts"],
    },
    resolve: {
        alias: {
            "evals-generator": fileURLToPath(new URL("./evals/generator", import.meta.url)),
            "#shared": fileURLToPath(new URL("./web/shared", import.meta.url)),
        },
    },
});

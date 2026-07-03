// 预烘：把 evals/report/report.json 复制成 web 的静态资源（public/report.json），
// 供报告页「加载内置示例报告」按钮 fetch。缺文件时跳过（拖放仍可用），不阻断 web 构建。
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../evals/report/report.json");
const out = resolve(here, "../public/report.json");

if (!existsSync(src)) {
    console.warn(`跳过内置示例报告：${src} 不存在（报告页拖放仍可用）。`);
    process.exit(0);
}

const raw = readFileSync(src, "utf-8");
const parsed = JSON.parse(raw) as {rules?: unknown; counts?: unknown; detector?: unknown};
if (!parsed || !Array.isArray(parsed.rules) || !parsed.counts || !parsed.detector) {
    throw new Error("evals/report/report.json 不是有效 report（缺 rules / counts / detector）");
}

mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, raw, "utf-8");
console.log(`report.json 已复制到 public：${parsed.rules.length} 条规则、${(raw.length / 1024).toFixed(0)}KB。`);

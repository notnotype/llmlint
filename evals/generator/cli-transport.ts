// CLI transport：用本地命令行工具调模型（claude -p / codex exec 这类无 HTTP API 的通道）。
// 契约：
// - prompt 一律走 stdin（brief 数千字中文，Windows argv 长度/转义/编码都是坑，禁止拼参数）。
// - system+user 合并规则统一为 `${system}\n\n---\n\n${user}`——所有 CLI 模型同一规则，
//   保证与 HTTP 模型输入尽量等价（HTTP 走真 system 字段，CLI 无此通道，是已知差异，byModel 解读时注意）。
// - 产出结构与 model-client 的 AssistantMessage 对齐（结构化类型兼容），复用同一套 classifyOutcome/callWithRetry。
import {spawn} from "node:child_process";
import type {CliProviderConfig} from "./eval-config";

/** 与 model-client 内部 AssistantMessage 结构一致（structural typing，避免循环依赖）。 */
type CliAssistantMessage = {
    content: Array<{type: string; text?: string}>;
    stopReason?: string;
    errorMessage?: string;
    usage?: {input?: number; output?: number};
};

/** CLI 通道的已解析模型（与 ResolvedModel 并列，kind 判别）。 */
export type CliModel = {
    kind: "cli";
    modelKey: string;
    providerId: string;
    modelId: string;
    command: string[];
    env: Record<string, string>;
    timeoutMs: number;
    output: "text" | "claude-json" | "codex-json";
};

const DEFAULT_CLI_TIMEOUT_MS = 600_000;

/** 从 eval.config 的 cliProviders 解析一个 CLI 模型。proxy 注入子进程 env（所有 provider 走 http proxy）。 */
export function resolveCliModel(providerId: string, modelId: string, cfg: CliProviderConfig, proxy?: string): CliModel {
    // proxy → 子进程 HTTP(S)_PROXY（claude/codex 都是 Node/Rust 客户端，读这两个环境变量）。
    const proxyEnv: Record<string, string> = proxy ? {HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy} : {};
    return {
        kind: "cli",
        modelKey: `${providerId}/${modelId}`,
        providerId,
        modelId,
        command: cfg.command.map((part) => part.replace("{MODEL}", modelId)),
        env: {...proxyEnv, ...(cfg.env ?? {})},
        timeoutMs: cfg.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS,
        output: cfg.output ?? "text",
    };
}

/**
 * 单次 CLI 补全：spawn 命令、stdin 喂合并 prompt、收 stdout。
 * 失败不在这里分类——非零退出/超时包装成 stopReason=error 的消息，交 classifyOutcome 统一裁决。
 */
export async function completeCliOnce(model: CliModel, system: string, user: string): Promise<CliAssistantMessage> {
    const prompt = `${system}\n\n---\n\n${user}`;
    const {stdout, stderr, code, timedOut} = await runCommand(model.command, prompt, model.env, model.timeoutMs);
    if (timedOut) {
        return {content: [], stopReason: "error", errorMessage: `CLI 超时(${Math.round(model.timeoutMs / 1000)}s)：${model.command[0]}`};
    }
    if (code !== 0) {
        return {content: [], stopReason: "error", errorMessage: `CLI exit=${code}：${(stderr || stdout).slice(-400)}`};
    }
    if (model.output === "claude-json") {
        return parseClaudeJson(stdout);
    }
    if (model.output === "codex-json") {
        return parseCodexJson(stdout);
    }
    return {content: [{type: "text", text: stdout.trim()}], stopReason: "stop"};
}

/** 解析 `codex exec --json` 的 JSONL：取最后一条 item.completed 且 item.type=agent_message 的 text。导出供单测。 */
export function parseCodexJson(stdout: string): CliAssistantMessage {
    let answer = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for (const line of stdout.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) {
            continue;
        }
        try {
            const ev = JSON.parse(trimmed) as {type?: string; item?: {type?: string; text?: string}; usage?: {input_tokens?: number; output_tokens?: number}};
            if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") {
                answer = ev.item.text; // 取最后一条（覆盖），多轮时以末条为准
            }
            if (ev.type === "turn.completed" && ev.usage) {
                inputTokens = ev.usage.input_tokens;
                outputTokens = ev.usage.output_tokens;
            }
        } catch {
            // 非 JSON 行跳过
        }
    }
    if (!answer.trim()) {
        return {content: [], stopReason: "error", errorMessage: `codex --json 无 agent_message：${stdout.slice(-200)}`};
    }
    return {content: [{type: "text", text: answer.trim()}], stopReason: "stop", usage: {input: inputTokens, output: outputTokens}};
}

/** 解析 `claude -p --output-format json` 的结果：result 字段 = 正文，usage 带真实 token 数。 */
function parseClaudeJson(stdout: string): CliAssistantMessage {
    try {
        const parsed = JSON.parse(stdout) as {result?: string; is_error?: boolean; subtype?: string; usage?: {input_tokens?: number; output_tokens?: number}};
        if (parsed.is_error) {
            return {content: [], stopReason: "error", errorMessage: `claude CLI is_error（subtype=${parsed.subtype ?? "?"}）：${String(parsed.result ?? "").slice(0, 300)}`};
        }
        return {
            content: [{type: "text", text: (parsed.result ?? "").trim()}],
            stopReason: "stop",
            usage: {input: parsed.usage?.input_tokens, output: parsed.usage?.output_tokens},
        };
    } catch {
        // JSON 解析不了按 error 处理（让 classifyOutcome 决定重试）：CLI 输出契约变了要显式暴露，不静默当正文。
        return {content: [], stopReason: "error", errorMessage: `claude CLI 输出不是合法 JSON：${stdout.slice(0, 200)}`};
    }
}

/**
 * spawn 一条命令：数组参数、UTF-8 stdin、收集 stdout/stderr、墙钟超时杀进程。
 * Windows 下 npm 全局安装的 CLI 是 .cmd shim，直接 spawn 不带 shell 找不到 → 包一层 cmd /c
 * （参数无空格/引号风险：prompt 走 stdin，argv 只有 flag 与 model id）。
 */
function runCommand(command: string[], stdin: string, extraEnv: Record<string, string>, timeoutMs: number): Promise<{stdout: string; stderr: string; code: number | null; timedOut: boolean}> {
    const [exe, ...args] = process.platform === "win32" ? ["cmd", "/c", ...command] : command;
    return new Promise((resolve) => {
        const child = spawn(exe!, args, {
            env: {...process.env, ...extraEnv},
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        child.stdout.setEncoding("utf-8").on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr.setEncoding("utf-8").on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve({stdout, stderr: `${stderr}\n${error.message}`, code: -1, timedOut});
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({stdout, stderr, code, timedOut});
        });
        child.stdin.write(stdin, "utf-8");
        child.stdin.end();
    });
}

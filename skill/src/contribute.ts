// contribute：把一轮审稿按共享档位裁剪成自包含条目，落进用户级发件箱（Task 24 Phase 2）。
//
// 本轮不发送、不联网。发件箱 ~/.llmlint/outbox/ 是上传队列的本地端，服务轮起来之后
// 才有 --send 把它们发出去。条目自包含（不引用项目路径），所以「将来征求发送同意时，
// 看到什么就发什么」。
//
// 裁剪是**白名单构造**：每档显式挑字段拼出新对象，不是复制整轮再删几个字段。
// 这样将来台账新增任何字段都默认不出现在导出里，默认方向是安全的那一边。
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {join, posix} from "node:path";
import {createHash} from "node:crypto";
import {loadConfig} from "./config";
import {loadRules} from "./rules";
import {DEFAULT_DETECTOR_VERSION, loadUserSettings, userStateDir, type SharingTier} from "./user-state";
import {LLMLINT_VERSION} from "./version";
import {isSafeRuleId, loadLedger, roundDir, saveLedger, snapshotNamesForFiles, type Ledger, type RoundDecision, type RoundEntry, type RoundMetrics, type RoundRetest} from "./round";

export const CONTRIBUTION_SCHEMA = "llmlint.contribution/1";

/** 一轮的规则命中分布，从轮目录里落盘的 check JSON 重算——不让 Agent 转抄，转抄就是往最贵的数据里掺噪声。 */
type CheckFacts = {
    ruleHits: Record<string, number>;
    densityHits: Record<string, number>;
    /** null = check JSON 缺失或没带篇幅字段。 */
    visibleChars: number | null;
};

const EMPTY_FACTS: CheckFacts = {ruleHits: {}, densityHits: {}, visibleChars: null};

/** 导出条目的正文块（只有 full 档有）。 */
type TextSnapshot = {name: string; content: string};

type ContributionPayload = {
    round: number;
    parentRound: number | null;
    startedAt: string;
    completedAt: string | null;
    summary: RoundMetrics | null;
    retest: RoundRetest | null;
    checkFacts: {source: CheckFacts; output: CheckFacts};
    judgment: {wantReadOnBefore: number | null; wantReadOnAfter: number | null; blind: false};
    sourceFileCount: number;
    decisionCount: number;
    localConfigSuggestionCount: number;
    // —— 以下 fragments 档起 ——
    sourceFiles?: string[];
    decisions?: RoundDecision[];
    localConfigSuggestions?: string[];
    comment?: string | null;
    // —— 以下 full 档起 ——
    texts?: {source: TextSnapshot[]; output: TextSnapshot[]};
};

export type Contribution = {
    schema: typeof CONTRIBUTION_SCHEMA;
    /** 扩展位：将来记忆系统用 "memory-snapshot" 走同一条管道。 */
    kind: "review-round";
    tier: Exclude<SharingTier, "off">;
    createdAt: string;
    projectId: string;
    /** 规范化 payload 的哈希，服务端幂等键。 */
    contentHash: string;
    /** 修前正文哈希：stats 档不带任何原文，靠它把同一篇稿子的多轮串起来。 */
    sourceHash: string;
    /** 修后正文哈希；缺 output 时为 null。 */
    outputHash: string | null;
    /** 非 null = 本条实际档位低于用户设置，值是原本要出的档。 */
    degradedFrom: SharingTier | null;
    /** output 快照集合不完整时固定写入；只有完整集合才允许哈希或进入 full 正文。 */
    degradedReason: "output-snapshots-incomplete" | null;
    client: {
        skillVersion: string;
        /** 活跃规则集指纹：命中数只有配上「当时哪些规则开着」才可解释。 */
        rulesetHash: string;
        detector: {space: string; version: string; chunkChars: number};
        login: "none";
    };
    payload: ContributionPayload;
};

/** 发件箱目录，与 settings.json 同根（LLMLINT_HOME 自动生效）。 */
export function outboxDir(): string {
    const dir = join(userStateDir(), "outbox");
    mkdirSync(dir, {recursive: true});
    return dir;
}

/** 正文哈希口径：CRLF→LF 归一后按文件名字典序 `name\0content\0` 拼接再 sha256。 */
export function hashTexts(texts: TextSnapshot[]): string {
    const sorted = [...texts].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    const hash = createHash("sha256");
    for (const text of sorted) {
        hash.update(`${text.name}\0${text.content.replace(/\r\n/g, "\n")}\0`);
    }
    return `sha256:${hash.digest("hex")}`;
}

/** 稳定序列化：对象键排序，保证同一 payload 在任何机器上都得到同一个 contentHash。 */
function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (typeof value === "object" && value !== null) {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/** 读一个目录下的全部文件为快照；目录不存在返回空数组（full 档据此判断要不要降级）。 */
function readSnapshots(dir: string): TextSnapshot[] {
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir, {withFileTypes: true})
        .filter((entry) => entry.isFile())
        .map((entry) => ({name: entry.name, content: readFileSync(join(dir, entry.name), "utf-8")}));
}

/**
 * 从落盘的 check JSON 统计命中分布。兼容单文件（kind:"check"）与多文件（kind:"check-multi"）两种形态；
 * 文件缺失或形状不认识时返回空统计而不是抛——命中分布缺失不该让整轮作废。
 */
export function readCheckFacts(filePath: string): CheckFacts {
    if (!existsSync(filePath)) {
        return EMPTY_FACTS;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    } catch {
        return EMPTY_FACTS;
    }
    if (typeof parsed !== "object" || parsed === null) {
        return EMPTY_FACTS;
    }
    const report = parsed as Record<string, unknown>;
    if (report.kind !== "check" && report.kind !== "check-multi") {
        return EMPTY_FACTS;
    }
    const ruleHits: Record<string, number> = {};
    const densityHits: Record<string, number> = {};
    const collect = (issues: unknown, density: unknown): void => {
        for (const value of Array.isArray(issues) ? issues : []) {
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                continue;
            }
            const issue = value as Record<string, unknown>;
            if (typeof issue.ruleId === "string" && isSafeRuleId(issue.ruleId)) {
                ruleHits[issue.ruleId] = (ruleHits[issue.ruleId] ?? 0) + 1;
            }
        }
        for (const value of Array.isArray(density) ? density : []) {
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                continue;
            }
            const issue = value as Record<string, unknown>;
            if (typeof issue.ruleId === "string" && isSafeRuleId(issue.ruleId) && isNonNegativeInteger(issue.hits)) {
                densityHits[issue.ruleId] = (densityHits[issue.ruleId] ?? 0) + issue.hits;
            }
        }
    };
    if (report.kind === "check") {
        collect(report.issues, report.densityIssues);
    } else {
        for (const value of Array.isArray(report.files) ? report.files : []) {
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                continue;
            }
            const file = value as Record<string, unknown>;
            collect(file.issues, file.densityIssues);
        }
    }
    const summary = typeof report.summary === "object" && report.summary !== null && !Array.isArray(report.summary)
        ? report.summary as Record<string, unknown>
        : null;
    const visibleChars = summary && isNonNegativeInteger(summary.visibleChars) ? summary.visibleChars : null;
    return {ruleHits, densityHits, visibleChars};
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

export type TrimInput = {
    entry: RoundEntry;
    tier: Exclude<SharingTier, "off">;
    facts: {source: CheckFacts; output: CheckFacts};
    texts: {source: TextSnapshot[]; output: TextSnapshot[]};
};

/**
 * 按档裁剪：显式挑字段构造，逐档叠加。
 *
 * - stats：只有数字与不可逆哈希，**没有任何文件名、片段原文、评语**。自由文本一律算泄露面。
 * - fragments：加文件名、疑难片段与判定、本地 config 建议、修后评语。
 * - full：再加修前修后全文。
 */
export function trimRoundForTier(input: TrimInput): ContributionPayload {
    const {entry, tier, facts} = input;
    const expectedSnapshots = snapshotNamesForFiles(entry.sourceFiles);
    const mappedDecisionFiles = mapDecisionFiles(entry, expectedSnapshots);
    const stats: ContributionPayload = {
        round: entry.round,
        parentRound: entry.parentRound,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        summary: entry.summary === null ? null : {
            staticIssues: entry.summary.staticIssues,
            densityIssues: entry.summary.densityIssues,
            docPAi: entry.summary.docPAi,
            spread: entry.summary.spread,
        },
        retest: entry.retest === null ? null : {
            staticIssues: entry.retest.staticIssues,
            densityIssues: entry.retest.densityIssues,
            docPAi: entry.retest.docPAi,
            spread: entry.retest.spread,
            verdict: entry.retest.verdict,
        },
        checkFacts: {source: trimCheckFacts(facts.source), output: trimCheckFacts(facts.output)},
        judgment: {
            wantReadOnBefore: entry.judgment.wantReadOnBefore,
            wantReadOnAfter: entry.judgment.wantReadOnAfter,
            blind: false,
        },
        sourceFileCount: entry.sourceFiles.length,
        decisionCount: entry.decisions.length,
        localConfigSuggestionCount: entry.localConfigSuggestions.length,
    };
    if (tier === "stats") {
        return stats;
    }
    const fragments: ContributionPayload = {
        ...stats,
        sourceFiles: [...expectedSnapshots],
        decisions: entry.decisions.map((decision, index) => ({
            file: mappedDecisionFiles[index]!,
            line: decision.line,
            ruleId: decision.ruleId,
            fragment: decision.fragment,
            verdict: decision.verdict,
            reason: decision.reason,
        })),
        localConfigSuggestions: [...entry.localConfigSuggestions],
        comment: entry.judgment.comment,
    };
    if (tier === "fragments") {
        return fragments;
    }
    return {...fragments, texts: {source: input.texts.source, output: input.texts.output}};
}

/** 对 stats 也先完成 decision→sourceFiles 交叉引用，坏轮只能跳过，不能导出半真数据。 */
function mapDecisionFiles(entry: RoundEntry, snapshotNames: string[]): string[] {
    const sources = entry.sourceFiles.map((file, index) => ({
        exact: normalizePortablePath(file),
        windows: isWindowsStylePath(file),
        snapshot: snapshotNames[index]!,
    }));
    return entry.decisions.map((decision) => {
        const exact = normalizePortablePath(decision.file);
        const exactMatches = sources.filter((source) => source.exact === exact);
        if (exactMatches.length === 1) {
            return exactMatches[0]!.snapshot;
        }
        if (exactMatches.length > 1) {
            throw new Error(`decision.file 无法唯一映射到 sourceFiles：${decision.file}`);
        }
        if (isWindowsStylePath(decision.file)) {
            const folded = exact.toLocaleLowerCase("en-US");
            const foldedMatches = sources.filter((source) => source.windows && source.exact.toLocaleLowerCase("en-US") === folded);
            if (foldedMatches.length === 1) {
                return foldedMatches[0]!.snapshot;
            }
        }
        throw new Error(`decision.file 不属于本轮 sourceFiles：${decision.file}`);
    });
}

/** 同时规范 POSIX/Windows 分隔符；大小写保持不变，避免 POSIX 文件被错误合并。 */
function normalizePortablePath(file: string): string {
    return posix.normalize(file.replace(/\\/g, "/"));
}

function isWindowsStylePath(file: string): boolean {
    return /^[a-z]:[\\/]/iu.test(file) || file.startsWith("\\\\") || file.includes("\\");
}

/** 导出层再次逐字段重建 check 事实，避免测试/未来调用者绕过读取层夹带数据。 */
function trimCheckFacts(facts: CheckFacts): CheckFacts {
    const ruleHits: Record<string, number> = {};
    const densityHits: Record<string, number> = {};
    for (const [ruleId, count] of Object.entries(facts.ruleHits)) {
        if (isSafeRuleId(ruleId) && isNonNegativeInteger(count)) {
            ruleHits[ruleId] = count;
        }
    }
    for (const [ruleId, count] of Object.entries(facts.densityHits)) {
        if (isSafeRuleId(ruleId) && isNonNegativeInteger(count)) {
            densityHits[ruleId] = count;
        }
    }
    return {
        ruleHits,
        densityHits,
        visibleChars: facts.visibleChars !== null && isNonNegativeInteger(facts.visibleChars) ? facts.visibleChars : null,
    };
}

/** 快照集合必须与 beginRound 生成的名字逐项一致；返回按 expected 排序后的稳定集合。 */
function exactSnapshotSet(texts: TextSnapshot[], expected: string[]): TextSnapshot[] | null {
    if (texts.length !== expected.length) {
        return null;
    }
    const byName = new Map(texts.map((text) => [text.name, text]));
    if (byName.size !== expected.length || expected.some((name) => !byName.has(name))) {
        return null;
    }
    return expected.map((name) => byName.get(name)!);
}

/** 活跃规则集指纹：规则 id 排序后 sha256 取前 16。命中数离开它无法解释（不知道当时哪些规则开着）。 */
async function rulesetFingerprint(cwd: string): Promise<string> {
    const {config} = await loadConfig({cwd});
    const loaded = await loadRules(config);
    const ids = loaded.rules.map((rule) => rule.id).sort();
    return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
}

/** 一轮的导出结果（dry-run 与真写共用，dry-run 只是不落盘）。 */
export type ContributionPreview = {
    round: number;
    tier: Exclude<SharingTier, "off">;
    degradedFrom: SharingTier | null;
    degradedReason: Contribution["degradedReason"];
    bytes: number;
    /** 真写时是发件箱里的文件名；dry-run 为 null。 */
    file: string | null;
};

export type ContributeResult = {
    /** wrote=已落盘；preview=只列不写；skipped=按设置整体不做。 */
    action: "wrote" | "preview" | "skipped";
    /** action=skipped 时的原因，直接打印给用户。 */
    reason: string | null;
    written: ContributionPreview[];
    /** 逐轮跳过原因（不合格轮、已导出轮）。 */
    skipped: Array<{round: number; reason: string}>;
};

export type ContributeOptions = {
    cwd: string;
    /** 只处理指定轮；缺省处理全部待导出轮。 */
    round: number | null;
    /** --yes：真写发件箱。 */
    write: boolean;
    /** --auto：由设置决定落 / 跳过 / 待确认（Agent 在步骤 5 调这个）。 */
    auto: boolean;
    /** 注入时间戳，测试用。 */
    now?: string;
};

/**
 * 主流程。--auto 的四种结局全在这里判，不放提示词里：
 * tier=off 不做；未初始化不做；mode=ask 只预览并提示加 --yes；mode=auto 直接写。
 */
export async function contribute(options: ContributeOptions): Promise<ContributeResult> {
    const settings = loadUserSettings();
    const empty: Pick<ContributeResult, "written" | "skipped"> = {written: [], skipped: []};

    if (settings.sharing.tier === "off") {
        return {action: "skipped", reason: "sharing.tier = off：不准备、不落盘任何数据。", ...empty};
    }
    let write = options.write;
    if (options.auto) {
        if (!settings.initialized) {
            return {action: "skipped", reason: "尚未完成初始化门（initialized=false）：先和用户确认共享档位再贡献。", ...empty};
        }
        if (settings.sharing.mode === "ask") {
            write = false;
        } else {
            write = true;
        }
    }

    const ledger = loadLedger(options.cwd);
    if (!ledger) {
        return {action: "skipped", reason: "没有找到 .agent/llmlint/session.json，本项目还没有审稿轮。", ...empty};
    }

    const tier = settings.sharing.tier;
    const skipped: Array<{round: number; reason: string}> = [];
    const candidates: RoundEntry[] = [];
    for (const entry of ledger.rounds) {
        if (typeof entry.round !== "number") {
            continue;
        }
        if (options.round !== null && entry.round !== options.round) {
            continue;
        }
        if (entry.status !== "completed") {
            skipped.push({round: entry.round, reason: `status=${String(entry.status)}，只有 completed 的轮参与导出`});
            continue;
        }
        if (entry.contributedAt !== null && entry.contributedAt !== undefined) {
            skipped.push({round: entry.round, reason: `已于 ${entry.contributedAt} 导出过`});
            continue;
        }
        if (!entry.judgment || !Array.isArray(entry.decisions) || !Array.isArray(entry.sourceFiles)) {
            skipped.push({round: entry.round, reason: "缺 v3 必要字段（judgment / decisions / sourceFiles）"});
            continue;
        }
        candidates.push(entry);
    }

    const written: ContributionPreview[] = [];
    const createdAt = options.now ?? new Date().toISOString();
    const rulesetHash = candidates.length > 0 ? await rulesetFingerprint(options.cwd) : "";
    for (const entry of candidates) {
        const dir = roundDir(options.cwd, entry.round);
        const expectedSnapshots = snapshotNamesForFiles(entry.sourceFiles);
        const sourceTexts = exactSnapshotSet(readSnapshots(join(dir, "source")), expectedSnapshots);
        if (sourceTexts === null) {
            skipped.push({round: entry.round, reason: "source 快照集合与 sourceFiles 不一致（存在缺失、额外或重名）"});
            continue;
        }
        const outputTexts = exactSnapshotSet(readSnapshots(join(dir, "output")), expectedSnapshots);
        const degradedReason: Contribution["degradedReason"] = outputTexts === null ? "output-snapshots-incomplete" : null;
        // full 档要完整 output 集合；缺失或额外文件都降级，不把半套正文伪装成完整修后稿。
        const degraded = tier === "full" && outputTexts === null;
        const effectiveTier: Exclude<SharingTier, "off"> = degraded ? "fragments" : tier;
        let payload: ContributionPayload;
        try {
            payload = trimRoundForTier({
                entry,
                tier: effectiveTier,
                facts: {
                    source: readCheckFacts(join(dir, "check-source.json")),
                    output: readCheckFacts(join(dir, "check-output.json")),
                },
                texts: {source: sourceTexts, output: outputTexts ?? []},
            });
        } catch (error) {
            skipped.push({
                round: entry.round,
                reason: error instanceof Error ? error.message : String(error),
            });
            continue;
        }
        const contribution: Contribution = {
            schema: CONTRIBUTION_SCHEMA,
            kind: "review-round",
            tier: effectiveTier,
            createdAt,
            projectId: ledger.projectId,
            contentHash: `sha256:${createHash("sha256").update(stableStringify(payload)).digest("hex")}`,
            sourceHash: hashTexts(sourceTexts),
            outputHash: outputTexts === null ? null : hashTexts(outputTexts),
            degradedFrom: degraded ? tier : null,
            degradedReason,
            client: {
                skillVersion: LLMLINT_VERSION,
                rulesetHash,
                detector: {
                    space: settings.detector.space,
                    version: DEFAULT_DETECTOR_VERSION,
                    chunkChars: settings.detector.chunkChars,
                },
                login: "none",
            },
            payload,
        };
        const serialized = `${JSON.stringify(contribution, null, 4)}\n`;
        const preview: ContributionPreview = {
            round: entry.round,
            tier: effectiveTier,
            degradedFrom: contribution.degradedFrom,
            degradedReason: contribution.degradedReason,
            bytes: Buffer.byteLength(serialized, "utf-8"),
            file: null,
        };
        if (write) {
            const stamp = createdAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
            const name = `${stamp}-${contribution.contentHash.slice(7, 15)}.json`;
            writeFileSync(join(outboxDir(), name), serialized, "utf-8");
            entry.contributedAt = createdAt;
            preview.file = name;
        }
        written.push(preview);
    }

    if (write && written.length > 0) {
        saveLedger(options.cwd, ledger as Ledger);
    }
    const reason = options.auto && !write && settings.sharing.mode === "ask"
        ? "sharing.mode = ask：只列不写，确认后用 `llmlint contribute --yes` 落盘。"
        : null;
    return {action: write ? "wrote" : "preview", reason, written, skipped};
}

export type OutboxEntry = {file: string; tier: string; kind: string; bytes: number; createdAt: string};

/** 列发件箱现有条目。发件箱只进不出，用户得能看见自己攒了什么、决定删不删。 */
export function listOutbox(): OutboxEntry[] {
    const dir = outboxDir();
    return readdirSync(dir, {withFileTypes: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => {
            const filePath = join(dir, entry.name);
            const bytes = statSync(filePath).size;
            try {
                const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<Contribution>;
                return {
                    file: entry.name,
                    tier: parsed.tier ?? "?",
                    kind: parsed.kind ?? "?",
                    bytes,
                    createdAt: parsed.createdAt ?? "?",
                };
            } catch {
                return {file: entry.name, tier: "?", kind: "?", bytes, createdAt: "?"};
            }
        })
        .sort((left, right) => (left.file < right.file ? -1 : 1));
}

#!/usr/bin/env bun
import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {parseArgs} from "node:util";
import {median, signTestP} from "../../evals/experiments/paired-stats";
import {prisma} from "../server/database/prisma";
import {listStyleReviewRecords, STYLE_REVIEW_ARMS, STYLE_REVIEW_CORPUS_PREFIX, STYLE_REVIEW_MODEL, type StyleReviewArm, type StyleReviewJudgment, type StyleReviewRecord} from "../server/utils/style-review";

export type ReviewScope = "owner-primary" | "all-reviewers";
export type ReviewerIdentity = {
    id: number;
    neuroBookUserId: number | null;
    role: "admin" | "user";
    status: "active" | "disabled";
};
type Axis = "aiFlavor" | "wantReadOn";
type ScopeStatus = "complete" | "incomplete" | "exploratory";

type ReviewRow = {
    genre: string;
    brief: string;
    pairRef: string;
    arm: StyleReviewArm;
    blindId: string;
    revisionId: string;
    charCount: number;
    lengthDeltaFromPairMedian: number;
    machine: {docScore: number | null; docPAi: number | null};
    judgments: StyleReviewJudgment[];
};

type ArmSummary = {
    /** 当前 scope 中该臂的有效双轴评分条数。 */
    judged: number;
    complete: number;
    wantReadOn: number[];
    aiFlavor: number[];
    wantReadOnMedian: number | null;
    aiFlavorMedian: number | null;
    comments: string[];
};

type ReviewerArmSummary = {
    count: number;
    aiFlavorMedian: number | null;
    wantReadOnMedian: number | null;
};

type ReviewerSummary = ReviewerIdentity & {
    submissionCount: number;
    completeSubmissionCount: number;
    invalidSubmissionCount: number;
    completeRevisionCount: number;
    byArm: Record<StyleReviewArm, ReviewerArmSummary>;
};

type PairReport = {
    genre: string;
    brief: string;
    pairRef: string;
    arms: Record<StyleReviewArm, ReviewRow | null>;
};

type PairObservation = {
    pairRef: string;
    brief: string;
    left: number;
    right: number;
    delta: number;
};

export type ReviewContrast = {
    leftArm: StyleReviewArm;
    rightArm: StyleReviewArm;
    axis: Axis;
    primary: boolean;
    unit: "pair-level" | "pair-level-median";
    leftMedian: number | null;
    rightMedian: number | null;
    deltaMedian: number | null;
    rightBetter: number;
    decidedCount: number;
    ties: number;
    pValue: number | null;
    observations: PairObservation[];
};

type ScopeReport = {
    scope: ReviewScope;
    status: ScopeStatus;
    expectedRevisionCount: number;
    completeRevisionCount: number;
    submissionCount: number;
    completeSubmissionCount: number;
    invalidSubmissionCount: number;
    missingBlindIds: string[];
    pairs: PairReport[];
    byGenre: Array<{genre: string; pairCount: number; judgedPairCount: number; arms: Record<StyleReviewArm, ArmSummary>} >;
    byReviewer: ReviewerSummary[];
    contrasts: ReviewContrast[];
};

export type StyleReviewReport = {
    experiment: "style-arm-v2";
    generatedAt: string;
    model: string;
    rowCount: number;
    pairCount: number;
    source: {snapshotSha256: string; inputFingerprint: string};
    ownerPrimary: ScopeReport;
    allReviewers: ScopeReport;
    notes: string[];
};

type ScopeSelection = {
    rawByRevision: Map<string, StyleReviewJudgment[]>;
    selectedByRevision: Map<string, StyleReviewJudgment[]>;
    expectedRevisionCount: number;
    completeRevisionCount: number;
    submissionCount: number;
    completeSubmissionCount: number;
    invalidSubmissionCount: number;
    missingBlindIds: string[];
};

type CliOptions = {
    out: string;
    ownerOfficialId: number;
    sourceSha256: string;
    requireOwnerComplete: boolean;
};

const AXES: readonly Axis[] = ["aiFlavor", "wantReadOn"];
const PRIMARY_COMPARISONS: Record<string, true> = {
    "control/current-default": true,
    "control/beileng-clean": true,
    "control/distilled": true,
};
const SNAPSHOT_SHA256 = /^sha256:[0-9a-f]{64}$/u;

/** 计算稳定 SHA-256 指纹。 */
function sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** 判断一个分数是否符合 0–5 的整数轴合同。 */
function isScore(value: number | null): value is number {
    return value !== null && Number.isInteger(value) && value >= 0 && value <= 5;
}

/** 只有盲评且两条评分轴均完整时，记录才进入人评统计。 */
function isCompleteJudgment(judgment: StyleReviewJudgment): boolean {
    return judgment.blind && isScore(judgment.aiFlavor) && isScore(judgment.wantReadOn);
}

/** 校验私池仍是固定的 5 个四臂配对，不静默缩小分析窗口。 */
function validatePool(records: readonly StyleReviewRecord[]): Map<string, StyleReviewRecord[]> {
    if (records.length !== 20) {
        throw new Error(`私池 revision 数量必须为 20，实际为 ${records.length}`);
    }
    for (const record of records) {
        if (record.model !== STYLE_REVIEW_MODEL) {
            throw new Error(`私池模型漂移：${record.corpusKey} 使用 ${record.model || "空值"}，期望 ${STYLE_REVIEW_MODEL}`);
        }
        if (!record.corpusKey.startsWith(STYLE_REVIEW_CORPUS_PREFIX)) {
            throw new Error(`私池语料前缀不匹配：${record.corpusKey}`);
        }
    }
    const byPair = new Map<string, StyleReviewRecord[]>();
    for (const record of records) {
        const group = byPair.get(record.pairRef) ?? [];
        group.push(record);
        byPair.set(record.pairRef, group);
    }
    if (byPair.size !== 5) {
        throw new Error(`私池配对题组数量必须为 5，实际为 ${byPair.size}`);
    }
    for (const [pairRef, group] of byPair) {
        const arms = group.map((record) => record.arm);
        if (group.length !== STYLE_REVIEW_ARMS.length || new Set(arms).size !== STYLE_REVIEW_ARMS.length || STYLE_REVIEW_ARMS.some((arm) => !arms.includes(arm))) {
            throw new Error(`私池配对 ${pairRef} 必须恰有四个不同臂：${arms.join(",")}`);
        }
    }
    return byPair;
}

/** 按 pair、臂和 revision 稳定排序，供明细和输入指纹复用。 */
function recordSort(left: StyleReviewRecord, right: StyleReviewRecord): number {
    return left.pairRef.localeCompare(right.pairRef) || left.arm.localeCompare(right.arm) || left.revisionId.localeCompare(right.revisionId);
}

/** 为每条 scope 生成选择结果，同时保留缺失和非法提交计数。 */
function selectScope(records: readonly StyleReviewRecord[], owner: ReviewerIdentity | null): ScopeSelection {
    const rawByRevision = new Map<string, StyleReviewJudgment[]>();
    const selectedByRevision = new Map<string, StyleReviewJudgment[]>();
    let submissionCount = 0;
    let completeSubmissionCount = 0;
    let invalidSubmissionCount = 0;
    let completeRevisionCount = 0;
    const missingBlindIds: string[] = [];

    for (const record of records) {
        const raw = owner === null ? record.judgments : record.judgments.filter((judgment) => judgment.userId === owner.id);
        const valid = raw.filter(isCompleteJudgment);
        rawByRevision.set(record.revisionId, raw);
        submissionCount += raw.length;
        completeSubmissionCount += valid.length;
        invalidSubmissionCount += raw.length - valid.length;
        if (owner !== null) {
            // Prisma 的复合唯一键保证最多一行；重复或非盲/不完整行都不能任意挑一行补齐主分析。
            if (raw.length !== 1 || valid.length !== 1) {
                missingBlindIds.push(record.blindId);
                selectedByRevision.set(record.revisionId, []);
                continue;
            }
        }
        if (valid.length > 0) {
            completeRevisionCount += 1;
        }
        selectedByRevision.set(record.revisionId, valid);
    }

    return {
        rawByRevision,
        selectedByRevision,
        expectedRevisionCount: records.length,
        completeRevisionCount,
        submissionCount,
        completeSubmissionCount,
        invalidSubmissionCount,
        missingBlindIds: [...new Set(missingBlindIds)].sort(),
    };
}

/** 将一个数据库记录投影为 scope 内的匿名 pair 明细。 */
function toRow(record: StyleReviewRecord, pairMedian: number, judgments: StyleReviewJudgment[]): ReviewRow {
    const [genre] = record.corpusKey.split("/");
    return {
        genre: genre ?? "unknown",
        brief: record.sourceRef,
        pairRef: record.pairRef,
        arm: record.arm,
        blindId: record.blindId,
        revisionId: record.revisionId,
        charCount: record.charCount,
        lengthDeltaFromPairMedian: record.charCount - pairMedian,
        machine: record.machine,
        judgments,
    };
}

/** 构造固定四臂的 pair 明细；缺 scope 评分时保留 null/空 judgments。 */
function buildPairs(records: readonly StyleReviewRecord[], selectedByRevision: Map<string, StyleReviewJudgment[]>): PairReport[] {
    const groups = new Map<string, StyleReviewRecord[]>();
    for (const record of records) {
        const group = groups.get(record.pairRef) ?? [];
        group.push(record);
        groups.set(record.pairRef, group);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([pairRef, group]) => {
        const pairMedian = median(group.map((record) => record.charCount)) ?? 0;
        const byArm = new Map(group.map((record) => [record.arm, record]));
        const arms = {} as Record<StyleReviewArm, ReviewRow | null>;
        for (const arm of STYLE_REVIEW_ARMS) {
            const record = byArm.get(arm);
            arms[arm] = record ? toRow(record, pairMedian, selectedByRevision.get(record.revisionId) ?? []) : null;
        }
        const first = group[0];
        return {genre: first ? first.corpusKey.split("/")[0] ?? "unknown" : "unknown", brief: first?.sourceRef ?? "", pairRef, arms};
    });
}

/** 创建空的四臂摘要。 */
function emptyArmSummary(): ArmSummary {
    return {judged: 0, complete: 0, wantReadOn: [], aiFlavor: [], wantReadOnMedian: null, aiFlavorMedian: null, comments: []};
}

/** 统计一个 scope 的题材/臂覆盖和两条评分轴。 */
function buildGenreSummary(pairs: readonly PairReport[]): StyleReviewReport["ownerPrimary"]["byGenre"] {
    const byGenre = new Map<string, PairReport[]>();
    for (const pair of pairs) {
        const group = byGenre.get(pair.genre) ?? [];
        group.push(pair);
        byGenre.set(pair.genre, group);
    }
    return [...byGenre.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([genre, genrePairs]) => {
        const arms = {} as Record<StyleReviewArm, ArmSummary>;
        for (const arm of STYLE_REVIEW_ARMS) {
            const summary = emptyArmSummary();
            for (const pair of genrePairs) {
                for (const judgment of pair.arms[arm]?.judgments ?? []) {
                    summary.judged += 1;
                    summary.complete += 1;
                    summary.aiFlavor.push(judgment.aiFlavor as number);
                    summary.wantReadOn.push(judgment.wantReadOn as number);
                    if (judgment.comment?.trim()) summary.comments.push(judgment.comment.trim());
                }
            }
            summary.aiFlavorMedian = median(summary.aiFlavor);
            summary.wantReadOnMedian = median(summary.wantReadOn);
            arms[arm] = summary;
        }
        const judgedPairCount = genrePairs.filter((pair) => STYLE_REVIEW_ARMS.every((arm) => (pair.arms[arm]?.judgments.length ?? 0) > 0)).length;
        return {genre, pairCount: genrePairs.length, judgedPairCount, arms};
    });
}

/** 创建 reviewer 的四臂覆盖摘要。 */
function emptyReviewerArms(): Record<StyleReviewArm, ReviewerArmSummary> {
    return Object.fromEntries(STYLE_REVIEW_ARMS.map((arm) => [arm, {count: 0, aiFlavorMedian: null, wantReadOnMedian: null}])) as Record<StyleReviewArm, ReviewerArmSummary>;
}

/** 统计 scope 内每个 reviewer 的提交、完整度和四臂覆盖。 */
function buildReviewerSummary(records: readonly StyleReviewRecord[], selection: ScopeSelection, reviewers: readonly ReviewerIdentity[]): ReviewerSummary[] {
    const relevant = new Set<number>();
    for (const judgments of selection.rawByRevision.values()) {
        for (const judgment of judgments) relevant.add(judgment.userId);
    }
    const rows: ReviewerSummary[] = [];
    for (const identity of reviewers) {
        if (!relevant.has(identity.id)) continue;
        const byArm = emptyReviewerArms();
        const aiValuesByArm = Object.fromEntries(STYLE_REVIEW_ARMS.map((arm) => [arm, [] as number[]])) as Record<StyleReviewArm, number[]>;
        const readValuesByArm = Object.fromEntries(STYLE_REVIEW_ARMS.map((arm) => [arm, [] as number[]])) as Record<StyleReviewArm, number[]>;
        const raw: StyleReviewJudgment[] = [];
        const valid: StyleReviewJudgment[] = [];
        const validRevisionIds = new Set<string>();
        for (const record of records) {
            const judgments = selection.rawByRevision.get(record.revisionId)?.filter((judgment) => judgment.userId === identity.id) ?? [];
            raw.push(...judgments);
            const complete = judgments.filter(isCompleteJudgment);
            valid.push(...complete);
            if (complete.length > 0) validRevisionIds.add(record.revisionId);
            const arm = byArm[record.arm];
            arm.count += complete.length;
            for (const judgment of complete) {
                if (isScore(judgment.aiFlavor)) aiValuesByArm[record.arm].push(judgment.aiFlavor);
                if (isScore(judgment.wantReadOn)) readValuesByArm[record.arm].push(judgment.wantReadOn);
            }
        }
        for (const arm of STYLE_REVIEW_ARMS) {
            byArm[arm].aiFlavorMedian = median(aiValuesByArm[arm]);
            byArm[arm].wantReadOnMedian = median(readValuesByArm[arm]);
        }
        rows.push({
            ...identity,
            submissionCount: raw.length,
            completeSubmissionCount: valid.length,
            invalidSubmissionCount: raw.length - valid.length,
            completeRevisionCount: validRevisionIds.size,
            byArm,
        });
    }
    return rows.sort((left, right) => left.id - right.id);
}

/** 取得某个 pair/臂在当前 scope 的轴中位数。 */
function pairAxisValue(row: ReviewRow | null, axis: Axis): number | null {
    if (!row || row.judgments.length === 0) return null;
    return median(row.judgments.flatMap((judgment) => isScore(judgment[axis]) ? [judgment[axis]] : []));
}

/** 判断处理臂在某评分轴是否优于左臂。 */
function rightIsBetter(axis: Axis, delta: number): boolean {
    return axis === "aiFlavor" ? delta < 0 : delta > 0;
}

/** 生成一个双轴、双臂的逐 pair 配对统计。 */
function buildContrast(pairs: readonly PairReport[], leftArm: StyleReviewArm, rightArm: StyleReviewArm, axis: Axis, unit: ReviewContrast["unit"]): ReviewContrast {
    const observations: PairObservation[] = [];
    for (const pair of pairs) {
        const left = pairAxisValue(pair.arms[leftArm], axis);
        const right = pairAxisValue(pair.arms[rightArm], axis);
        if (left === null || right === null) continue;
        observations.push({pairRef: pair.pairRef, brief: pair.brief, left, right, delta: right - left});
    }
    const deltas = observations.map((observation) => observation.delta);
    const ties = deltas.filter((delta) => delta === 0).length;
    const better = observations.filter((observation) => rightIsBetter(axis, observation.delta)).length;
    return {
        leftArm,
        rightArm,
        axis,
        primary: PRIMARY_COMPARISONS[`${leftArm}/${rightArm}`] === true,
        unit,
        leftMedian: median(observations.map((observation) => observation.left)),
        rightMedian: median(observations.map((observation) => observation.right)),
        deltaMedian: median(deltas),
        rightBetter: better,
        decidedCount: observations.length - ties,
        ties,
        pValue: signTestP(better, observations.length - ties),
        observations,
    };
}

/** 为全部六个臂对比和两个评分轴生成统计。 */
function buildContrasts(pairs: readonly PairReport[], unit: ReviewContrast["unit"]): ReviewContrast[] {
    const contrasts: ReviewContrast[] = [];
    for (let leftIndex = 0; leftIndex < STYLE_REVIEW_ARMS.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < STYLE_REVIEW_ARMS.length; rightIndex += 1) {
            const leftArm = STYLE_REVIEW_ARMS[leftIndex]!;
            const rightArm = STYLE_REVIEW_ARMS[rightIndex]!;
            for (const axis of AXES) contrasts.push(buildContrast(pairs, leftArm, rightArm, axis, unit));
        }
    }
    return contrasts;
}

/** 计算冻结输入指纹；包含正文哈希、实验键和全部相关 judgment 字段。 */
function inputFingerprint(records: readonly StyleReviewRecord[]): string {
    const canonical = [...records].sort(recordSort).map((record) => ({
        corpusKey: record.corpusKey,
        sourceRef: record.sourceRef,
        pairRef: record.pairRef,
        arm: record.arm,
        model: record.model,
        revisionId: record.revisionId,
        bodySha256: sha256(record.body),
        judgments: [...record.judgments].sort((left, right) => left.userId - right.userId).map((judgment) => ({
            userId: judgment.userId,
            revisionId: record.revisionId,
            aiFlavor: judgment.aiFlavor,
            wantReadOn: judgment.wantReadOn,
            comment: judgment.comment,
            blind: judgment.blind,
        })),
    }));
    return sha256(JSON.stringify(canonical));
}

/** 用 reviewer 身份构造一个 scope 报告。 */
function buildScopeReport(records: readonly StyleReviewRecord[], reviewers: readonly ReviewerIdentity[], selection: ScopeSelection, owner: ReviewerIdentity | null, scope: ReviewScope): ScopeReport {
    const pairs = buildPairs(records, selection.selectedByRevision);
    return {
        scope,
        status: scope === "all-reviewers" ? "exploratory" : selection.missingBlindIds.length === 0 ? "complete" : "incomplete",
        expectedRevisionCount: selection.expectedRevisionCount,
        completeRevisionCount: selection.completeRevisionCount,
        submissionCount: selection.submissionCount,
        completeSubmissionCount: selection.completeSubmissionCount,
        invalidSubmissionCount: selection.invalidSubmissionCount,
        missingBlindIds: selection.missingBlindIds,
        pairs,
        byGenre: buildGenreSummary(pairs),
        byReviewer: buildReviewerSummary(records, selection, reviewers),
        contrasts: buildContrasts(pairs, owner === null ? "pair-level-median" : "pair-level"),
    };
}

/**
 * 从固定四臂私池和 reviewer 身份生成可复现的人评报告。
 * requireOwnerComplete=true 时，owner 缺任何一份有效盲评会直接抛错。
 */
export function buildStyleReviewReport(
    records: readonly StyleReviewRecord[],
    reviewers: readonly ReviewerIdentity[],
    ownerOfficialUserId: number,
    snapshotSha256: string,
    requireOwnerComplete: boolean,
): StyleReviewReport {
    validatePool(records);
    if (requireOwnerComplete && !SNAPSHOT_SHA256.test(snapshotSha256)) {
        throw new Error("--source-sha256 必须是 sha256:<64位小写十六进制>，完整报告拒绝继续");
    }
    const owners = reviewers.filter((reviewer) => reviewer.neuroBookUserId === ownerOfficialUserId && reviewer.role === "admin" && reviewer.status === "active");
    if (owners.length !== 1) {
        throw new Error(`官方 owner=${ownerOfficialUserId} 必须唯一映射到 active admin，实际 ${owners.length} 个`);
    }
    const owner = owners[0]!;
    const ownerSelection = selectScope(records, owner);
    if (requireOwnerComplete && ownerSelection.missingBlindIds.length > 0) {
        throw new Error(`owner-primary 未完成 ${ownerSelection.missingBlindIds.length}/20 份盲评：${ownerSelection.missingBlindIds.join(", ")}`);
    }
    const allSelection = selectScope(records, null);
    const ownerPrimary = buildScopeReport(records, reviewers, ownerSelection, owner, "owner-primary");
    const allReviewers = buildScopeReport(records, reviewers, allSelection, null, "all-reviewers");
    return {
        experiment: "style-arm-v2",
        generatedAt: new Date().toISOString(),
        model: STYLE_REVIEW_MODEL,
        rowCount: records.length,
        pairCount: new Set(records.map((record) => record.pairRef)).size,
        source: {snapshotSha256: snapshotSha256 || "unverified", inputFingerprint: inputFingerprint(records)},
        ownerPrimary,
        allReviewers,
        notes: [
            "DocJudgment 的 aiFlavor 与 wantReadOn 是人类偏好真值；MachineScan/MachineDetect 只作机器对照。",
            "四臂统计单位是同一 pair 内的配对 revision；不把 20 行或多 reviewer 行当作独立样本。",
            "owner-primary 仅使用 neuroBookUserId=1 的 active admin；all-reviewers 仅作 exploratory 复核。",
            "n=5 时双侧精确符号检验即使 5/5 同向也只能得到 p=0.0625，不据此写统计显著。",
        ],
    };
}

/** 解析 CLI 参数并拒绝非法 owner 官方 ID。 */
function parseCliOptions(): CliOptions {
    const {values} = parseArgs({
        options: {
            out: {type: "string", default: ".agent/tmp/style-review-report.json"},
            "owner-official-id": {type: "string", default: "1"},
            "source-sha256": {type: "string", default: ""},
            "require-owner-complete": {type: "boolean", default: false},
        },
    });
    const ownerOfficialId = Number.parseInt(values["owner-official-id"] ?? "", 10);
    if (!Number.isSafeInteger(ownerOfficialId) || ownerOfficialId <= 0) {
        throw new Error(`--owner-official-id 必须为正整数：${values["owner-official-id"] ?? ""}`);
    }
    return {
        out: values.out ?? ".agent/tmp/style-review-report.json",
        ownerOfficialId,
        sourceSha256: values["source-sha256"] ?? "",
        requireOwnerComplete: values["require-owner-complete"] ?? false,
    };
}

/** 从数据库读取本轮 judgment 涉及的用户及 owner 官方映射。 */
async function loadReviewerIdentities(records: readonly StyleReviewRecord[], ownerOfficialId: number): Promise<ReviewerIdentity[]> {
    const userIds = [...new Set(records.flatMap((record) => record.judgments.map((judgment) => judgment.userId)))];
    const users = await prisma.user.findMany({
        where: {OR: [{id: {in: userIds}}, {neuroBookUserId: ownerOfficialId}]},
        select: {id: true, neuroBookUserId: true, role: true, status: true},
    });
    return users.map((user) => ({id: user.id, neuroBookUserId: user.neuroBookUserId, role: user.role, status: user.status}));
}

/** CLI 入口：只读数据库，写入本地 JSON 报告。 */
async function main(): Promise<void> {
    const options = parseCliOptions();
    try {
        const records = await listStyleReviewRecords();
        const reviewers = await loadReviewerIdentities(records, options.ownerOfficialId);
        const report = buildStyleReviewReport(records, reviewers, options.ownerOfficialId, options.sourceSha256, options.requireOwnerComplete);
        const output = resolve(options.out);
        mkdirSync(dirname(output), {recursive: true});
        writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        console.log(`已写入文风盲评报告：${output}；配对 ${report.pairCount}；owner ${report.ownerPrimary.completeRevisionCount}/${report.ownerPrimary.expectedRevisionCount}；有效提交 ${report.allReviewers.completeSubmissionCount}/${report.allReviewers.submissionCount}`);
    } finally {
        await prisma.$disconnect();
    }
}

if (import.meta.main) {
    await main();
}

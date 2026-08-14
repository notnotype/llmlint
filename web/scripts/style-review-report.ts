#!/usr/bin/env bun
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {parseArgs} from "node:util";
import {prisma} from "../server/database/prisma";
import {listStyleReviewRecords, STYLE_REVIEW_ARMS, STYLE_REVIEW_MODEL, type StyleReviewArm, type StyleReviewRecord} from "../server/utils/style-review";

type ReviewJudgment = StyleReviewRecord["judgments"][number];

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
    judgments: ReviewJudgment[];
};

type ArmSummary = {
    /** 所有已提交记录数，包含不完整旧数据，便于审计原始覆盖。 */
    judged: number;
    /** 同时具备 aiFlavor 与 wantReadOn 的有效提交数。 */
    complete: number;
    wantReadOn: number[];
    aiFlavor: number[];
    comments: string[];
};

type UserSummary = {
    userId: number;
    submissionCount: number;
    /** 该用户至少完成双轴评分的不同 revision 数。 */
    judgedRowCount: number;
    wantReadOn: number[];
    aiFlavor: number[];
    comments: string[];
};

type PairReport = {
    genre: string;
    brief: string;
    pairRef: string;
    arms: Record<StyleReviewArm, ReviewRow | null>;
};

type StyleReviewReport = {
    experiment: "style-arm-v1";
    generatedAt: string;
    model: string;
    rowCount: number;
    /** 至少一条同时含两条评分轴的评分的 revision 数。 */
    judgedRowCount: number;
    submissionCount: number;
    byUser: UserSummary[];
    pairs: PairReport[];
    byGenre: Array<{genre: string; pairCount: number; judgedPairCount: number; arms: Record<StyleReviewArm, ArmSummary>}>;
    notes: string[];
};

const {values} = parseArgs({options: {out: {type: "string", default: ".agent/tmp/style-review-report.json"}}});

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] ?? null : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function emptyArmSummary(): ArmSummary {
    return {judged: 0, complete: 0, wantReadOn: [], aiFlavor: [], comments: []};
}

function isCompleteJudgment(judgment: ReviewJudgment): boolean {
    return judgment.aiFlavor !== null && judgment.wantReadOn !== null;
}

function pairKey(record: StyleReviewRecord): string {
    const namespace = record.corpusKey.slice(0, record.corpusKey.lastIndexOf("/render-"));
    return `${namespace}/${record.sourceRef}`;
}

function toRow(record: StyleReviewRecord, pairMedian: number): ReviewRow {
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
        judgments: record.judgments,
    };
}

function buildPairs(records: StyleReviewRecord[]): PairReport[] {
    const groupedRecords = new Map<string, StyleReviewRecord[]>();
    for (const record of records) {
        const key = pairKey(record);
        const group = groupedRecords.get(key) ?? [];
        group.push(record);
        groupedRecords.set(key, group);
    }
    return [...groupedRecords.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => {
        const pairMedian = median(group.map((record) => record.charCount)) ?? 0;
        const arms = new Map(group.map((record) => [record.arm, toRow(record, pairMedian)]));
        const parts = key.split("/");
        const genre = parts[0] ?? "unknown";
        const brief = parts.at(-1) ?? "";
        const pair = {} as Record<StyleReviewArm, ReviewRow | null>;
        for (const arm of STYLE_REVIEW_ARMS) pair[arm] = arms.get(arm) ?? null;
        return {genre, brief, pairRef: group[0]?.pairRef ?? "", arms: pair};
    });
}

function buildGenreSummary(pairs: PairReport[]): StyleReviewReport["byGenre"] {
    const byGenre = new Map<string, PairReport[]>();
    for (const pair of pairs) {
        const genrePairs = byGenre.get(pair.genre) ?? [];
        genrePairs.push(pair);
        byGenre.set(pair.genre, genrePairs);
    }
    return [...byGenre.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([genre, genrePairs]) => {
        const arms = {} as Record<StyleReviewArm, ArmSummary>;
        for (const arm of STYLE_REVIEW_ARMS) {
            const summary = emptyArmSummary();
            for (const pair of genrePairs) {
                for (const judgment of pair.arms[arm]?.judgments ?? []) {
                    summary.judged += 1;
                    if (isCompleteJudgment(judgment)) summary.complete += 1;
                    if (judgment.wantReadOn !== null) summary.wantReadOn.push(judgment.wantReadOn);
                    if (judgment.aiFlavor !== null) summary.aiFlavor.push(judgment.aiFlavor);
                    if (judgment.comment?.trim()) summary.comments.push(judgment.comment.trim());
                }
            }
            arms[arm] = summary;
        }
        const judgedPairCount = genrePairs.filter((pair) => STYLE_REVIEW_ARMS.every((arm) => (pair.arms[arm]?.judgments.some(isCompleteJudgment) ?? false))).length;
        return {genre, pairCount: genrePairs.length, judgedPairCount, arms};
    });
}

function buildUserSummary(records: StyleReviewRecord[]): UserSummary[] {
    const byUser = new Map<number, UserSummary>();
    for (const record of records) {
        for (const judgment of record.judgments) {
            const summary = byUser.get(judgment.userId) ?? {userId: judgment.userId, submissionCount: 0, judgedRowCount: 0, wantReadOn: [], aiFlavor: [], comments: []};
            summary.submissionCount += 1;
            if (isCompleteJudgment(judgment)) summary.judgedRowCount += 1;
            if (judgment.wantReadOn !== null) summary.wantReadOn.push(judgment.wantReadOn);
            if (judgment.aiFlavor !== null) summary.aiFlavor.push(judgment.aiFlavor);
            if (judgment.comment?.trim()) summary.comments.push(judgment.comment.trim());
            byUser.set(judgment.userId, summary);
        }
    }
    return [...byUser.values()].sort((left, right) => left.userId - right.userId);
}

async function main(): Promise<void> {
    try {
        const records = await listStyleReviewRecords();
        const pairs = buildPairs(records);
        const byUser = buildUserSummary(records);
        const submissionCount = records.reduce((total, record) => total + record.judgments.length, 0);
        const judgedRowCount = records.filter((record) => record.judgments.some(isCompleteJudgment)).length;
        const report: StyleReviewReport = {
            experiment: "style-arm-v1",
            generatedAt: new Date().toISOString(),
            model: STYLE_REVIEW_MODEL,
            rowCount: records.length,
            judgedRowCount,
            submissionCount,
            byUser,
            pairs,
            byGenre: buildGenreSummary(pairs),
            notes: [
                "用户 judgment 是舒服度终审；机器指标只作诊断。",
                "每个 pair 按题材/brief 展开，缺失 judgment 或 machine 指标保留为空，不以缺失冒充胜负。",
                "有效覆盖定义为同一 revision 至少有一条同时包含 aiFlavor 与 wantReadOn 的评分；只有 comment 的记录保留在明细，但不计入 judgedRowCount。",
                `wantReadOn 中位数：${median(records.flatMap((record) => record.judgments.flatMap((judgment) => judgment.wantReadOn === null ? [] : [judgment.wantReadOn])))}。`,
            ],
        };
        const output = resolve(values.out ?? ".agent/tmp/style-review-report.json");
        mkdirSync(dirname(output), {recursive: true});
        writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        console.log(`已写入文风盲评报告：${output}；配对 ${pairs.length}；有效覆盖 ${report.judgedRowCount}/${report.rowCount}；提交 ${report.submissionCount}`);
    } finally {
        await prisma.$disconnect();
    }
}

await main();

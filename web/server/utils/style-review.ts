import {createHash} from "node:crypto";
import {prisma, type PrismaClient} from "../database/prisma";

export const STYLE_REVIEW_ARMS = ["control", "current-default", "beileng-clean", "distilled"] as const;
export const STYLE_REVIEW_MODEL = "deepseek/deepseek-v4-flash";
export const STYLE_REVIEW_CORPUS_PREFIX = "light-novel/villain-loli/";
export type StyleReviewArm = typeof STYLE_REVIEW_ARMS[number];

export type StyleReviewItem = {
    blindId: string;
    body: string;
    charCount: number;
    pairRef: string;
    myJudgment: {aiFlavor: number | null; wantReadOn: number | null; comment: string | null} | null;
};

export type StyleReviewListResponse = {
    items: StyleReviewItem[];
    count: number;
};

export type StyleReviewMachine = {
    docScore: number | null;
    docPAi: number | null;
};

export type StyleReviewJudgment = {
    userId: number;
    aiFlavor: number | null;
    wantReadOn: number | null;
    comment: string | null;
    blind: boolean;
};

export type StyleReviewAdminItem = StyleReviewItem & {
    revisionId: string;
    arm: StyleReviewArm;
    machine: StyleReviewMachine;
    judgments: StyleReviewJudgment[];
};

export type StyleReviewAdminReport = {
    items: StyleReviewAdminItem[];
    count: number;
};

export type StyleReviewRecord = StyleReviewAdminItem & {
    textId: string;
    corpusKey: string;
    sourceRef: string;
};

/**
 * 以用户与 revision 的复合唯一键保存私池评分。
 * 私池评分始终是盲评，不读取或修改 Revision.revealedAt。
 */
export async function savePrivateStyleReviewJudgment(
    input: {userId: number; revisionId: string; aiFlavor: number; wantReadOn: number; comment: string | null},
    client?: Pick<PrismaClient, "docJudgment">,
): Promise<{judgmentId: string; blind: true}> {
    const database = client ?? prisma;
    const judgment = await database.docJudgment.upsert({
        where: {userId_revisionId: {userId: input.userId, revisionId: input.revisionId}},
        create: {
            revisionId: input.revisionId,
            userId: input.userId,
            aiFlavor: input.aiFlavor,
            wantReadOn: input.wantReadOn,
            improvementScore: null,
            comment: input.comment,
            blind: true,
        },
        update: {
            aiFlavor: input.aiFlavor,
            wantReadOn: input.wantReadOn,
            improvementScore: null,
            comment: input.comment,
            blind: true,
        },
    });
    return {judgmentId: judgment.id, blind: true};
}

type RawJson = Record<string, unknown>;

type ImportedText = {
    id: string;
    genre: string | null;
    modelKey: string | null;
    genParamsJson: string | null;
    revisions: Array<{
        id: string;
        ordinal: number;
        body: string;
        charCount: number;
        provenanceJson: string | null;
        machineScans: Array<{docScore: number; scannedAt: Date}>;
        machineDetects: Array<{docPAi: number; checkedAt: Date}>;
        judgments: Array<StyleReviewJudgment>;
    }>;
};

function hashPrefix(value: string, length: number): string {
    return createHash("sha256").update(value, "utf8").digest("hex").slice(0, length);
}

function parseJson(value: string | null): RawJson | null {
    if (!value) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as RawJson : null;
    } catch {
        return null;
    }
}

function readString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function parseArm(corpusKey: string): StyleReviewArm | null {
    const file = corpusKey.slice(corpusKey.lastIndexOf("/") + 1);
    const match = file.match(/^render-.+-(control|current-default|beileng-clean|distilled)\.md$/u);
    const arm = match?.[1];
    return STYLE_REVIEW_ARMS.includes(arm as StyleReviewArm) ? arm as StyleReviewArm : null;
}

function latestScan(rows: ImportedText["revisions"][number]["machineScans"]): ImportedText["revisions"][number]["machineScans"][number] | null {
    return [...rows].sort((left, right) => left.scannedAt.getTime() - right.scannedAt.getTime()).at(-1) ?? null;
}

function latestDetect(rows: ImportedText["revisions"][number]["machineDetects"]): ImportedText["revisions"][number]["machineDetects"][number] | null {
    return [...rows].sort((left, right) => left.checkedAt.getTime() - right.checkedAt.getTime()).at(-1) ?? null;
}

async function loadImportedTexts(): Promise<ImportedText[]> {
    const importer = await prisma.user.findUnique({where: {username: "corpus-import"}, select: {id: true}});
    if (!importer) {
        return [];
    }
    return prisma.text.findMany({
        where: {uploaderId: importer.id, originKind: "generated", visibility: "private", modelKey: STYLE_REVIEW_MODEL},
        orderBy: {createdAt: "asc"},
        select: {
            id: true,
            genre: true,
            modelKey: true,
            genParamsJson: true,
            revisions: {
                where: {ordinal: 0},
                select: {
                    id: true,
                    ordinal: true,
                    body: true,
                    charCount: true,
                    provenanceJson: true,
                    machineScans: {select: {docScore: true, scannedAt: true}},
                    machineDetects: {select: {docPAi: true, checkedAt: true}},
                    judgments: {select: {userId: true, aiFlavor: true, wantReadOn: true, comment: true, blind: true}},
                },
            },
        },
    });
}

function toRecord(text: ImportedText): StyleReviewRecord | null {
    const revision = text.revisions[0];
    if (!revision) {
        return null;
    }
    const corpusKey = readString(parseJson(revision.provenanceJson)?.corpusKey);
    const sourceRef = readString(parseJson(text.genParamsJson)?.sourceRef);
    const arm = corpusKey ? parseArm(corpusKey) : null;
    if (!corpusKey || !corpusKey.startsWith(STYLE_REVIEW_CORPUS_PREFIX) || !sourceRef || !arm || text.modelKey !== STYLE_REVIEW_MODEL) {
        return null;
    }
    const namespace = corpusKey.slice(0, corpusKey.lastIndexOf("/render-"));
    const pairIdentity = `${namespace}/${sourceRef}`;
    const scan = latestScan(revision.machineScans);
    const detect = latestDetect(revision.machineDetects);
    return {
        textId: text.id,
        corpusKey,
        sourceRef,
        blindId: `blind-${hashPrefix(corpusKey, 24)}`,
        revisionId: revision.id,
        body: revision.body,
        charCount: revision.charCount,
        pairRef: `pair-${hashPrefix(pairIdentity, 16)}`,
        arm,
        myJudgment: null,
        machine: {docScore: scan?.docScore ?? null, docPAi: detect?.docPAi ?? null},
        judgments: revision.judgments,
    };
}

function keepCompletePairs(records: StyleReviewRecord[]): StyleReviewRecord[] {
    const byPair = new Map<string, StyleReviewRecord[]>();
    for (const record of records) {
        const group = byPair.get(record.pairRef) ?? [];
        group.push(record);
        byPair.set(record.pairRef, group);
    }
    return [...byPair.values()]
        .filter((group) => group.length === STYLE_REVIEW_ARMS.length && STYLE_REVIEW_ARMS.every((arm) => group.some((record) => record.arm === arm)))
        .flat();
}

export async function listStyleReviewRecords(): Promise<StyleReviewRecord[]> {
    const records = (await loadImportedTexts()).flatMap((text) => {
        const record = toRecord(text);
        return record ? [record] : [];
    });
    return keepCompletePairs(records).sort((left, right) => left.blindId.localeCompare(right.blindId));
}

export async function findStyleReviewRecord(blindId: string): Promise<StyleReviewRecord | null> {
    const records = await listStyleReviewRecords();
    return records.find((record) => record.blindId === blindId) ?? null;
}

export function publicStyleReviewItem(record: StyleReviewRecord, userId?: number): StyleReviewItem {
    const judgment = userId === undefined ? null : record.judgments.find((item) => item.userId === userId) ?? null;
    return {
        blindId: record.blindId,
        body: record.body,
        charCount: record.charCount,
        pairRef: record.pairRef,
        myJudgment: judgment ? {aiFlavor: judgment.aiFlavor, wantReadOn: judgment.wantReadOn, comment: judgment.comment} : null,
    };
}

export function adminStyleReviewItem(record: StyleReviewRecord): StyleReviewAdminItem {
    return {
        ...publicStyleReviewItem(record),
        revisionId: record.revisionId,
        arm: record.arm,
        machine: record.machine,
        judgments: record.judgments,
    };
}

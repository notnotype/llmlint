import {requireAdmin} from "../utils/auth";
import {prisma} from "../database/prisma";

type ExportHitDto = {
    ruleId: string;
    span: {start: number; end: number};
    level: string;
    review: string;
};

type ExportMachineRecordDto = {
    id: string;
    textId: string;
    engineVersion: string;
    hits: ExportHitDto[];
    scannedAt: string;
};

/**
 * 管理员导出检测数据，按 engineVersion 分组供 Task 03 后处理。
 */
export default defineEventHandler(async (event): Promise<{engineVersions: Record<string, {texts: unknown[]; judgments: unknown[]; annotations: unknown[]; machineRecords: ExportMachineRecordDto[]}>}> => {
    await requireAdmin(event);
    const texts = await prisma.text.findMany({
        include: {
            judgments: true,
            annotations: true,
            machineRecord: true,
        },
        orderBy: {createdAt: "asc"},
    });

    const engineVersions: Record<string, {texts: unknown[]; judgments: unknown[]; annotations: unknown[]; machineRecords: ExportMachineRecordDto[]}> = {};
    for (const text of texts) {
        const version = text.machineRecord?.engineVersion ?? "unscanned";
        engineVersions[version] ??= {texts: [], judgments: [], annotations: [], machineRecords: []};
        engineVersions[version].texts.push({
            id: text.id,
            body: {text: text.body, charCount: text.charCount},
            classification: {genre: text.genre, pov: text.pov, textType: text.textType},
            origin: {
                kind: text.originKind === "user_upload" ? "user-upload" : "seeded-gold",
                declaredProvenance: text.declaredProvenance,
                trueProvenance: text.goldProvenance,
            },
            ownership: {uploaderId: String(text.uploaderId), visibility: text.visibility, consent: text.consent},
            createdAt: text.createdAt.toISOString(),
        });
        engineVersions[version].judgments.push(...text.judgments.map((judgment) => ({
            id: judgment.id,
            textId: judgment.textId,
            userId: String(judgment.userId),
            scores: {aiFlavor: judgment.aiFlavor, wantReadOn: judgment.wantReadOn},
            phase: judgment.phase === "pre_edit" ? "pre-edit" : "post-edit",
            blind: judgment.blind,
            createdAt: judgment.createdAt.toISOString(),
        })));
        engineVersions[version].annotations.push(...text.annotations.map((annotation) => ({
            id: annotation.id,
            textId: annotation.textId,
            userId: String(annotation.userId),
            target: annotation.target,
            span: {start: annotation.start, end: annotation.end},
            note: annotation.note,
            createdAt: annotation.createdAt.toISOString(),
        })));
        if (text.machineRecord) {
            const parsedHits = JSON.parse(text.machineRecord.hitsJson) as ExportHitDto[];
            engineVersions[version].machineRecords.push({
                id: text.machineRecord.id,
                textId: text.machineRecord.textId,
                engineVersion: text.machineRecord.engineVersion,
                hits: parsedHits,
                scannedAt: text.machineRecord.scannedAt.toISOString(),
            });
        }
    }

    return {engineVersions};
});

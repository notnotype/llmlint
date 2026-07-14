import {requireAdmin} from "../utils/auth";
import {liftAdmissible} from "../utils/gates";
import type {MachineDetectDto, MachineScanHitDto} from "../utils/scan";
import {prisma} from "../database/prisma";

/**
 * 管理员导出检测数据：文档信封 + 完整修订谱系，机器断言按拆分后的表 dump
 * （每版 machineScans / machineDetects 数组，Task 12/13），外加按 engineVersion 的扫描索引
 * 供 Task 03 后处理（规则会变，跨版本命中不可直接比）。
 * phase(pre/post) 与 target(original/edit) 由 revision.ordinal 派生，保持对下游的旧语义。
 * 每个 revision 附 liftAdmissible 准入标记（W5 闸门，utils/gates.ts），下游 lift/检测器训练按它过滤。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const texts = await prisma.text.findMany({
        include: {
            revisions: {
                orderBy: {ordinal: "asc"},
                include: {machineScans: true, machineDetects: true, judgments: true, annotations: true},
            },
        },
        orderBy: {createdAt: "asc"},
    });

    const byEngineVersion: Record<string, Array<{textId: string; revisionId: string}>> = {};
    const exportedTexts = texts.map((text) => ({
        id: text.id,
        classification: {
            genre: text.genre,
            genreSource: text.genreSource,
            pov: text.pov,
            povSource: text.povSource,
            textType: text.textType,
            textTypeSource: text.textTypeSource,
        },
        origin: {
            kind: text.originKind,
            declaredProvenance: text.declaredProvenance,
            sourceNote: text.sourceNote,
            modelKey: text.modelKey,
            genParamsJson: text.genParamsJson,
        },
        ownership: {uploaderId: String(text.uploaderId), visibility: text.visibility, consent: text.consent},
        createdAt: text.createdAt.toISOString(),
        revisions: text.revisions.map((revision) => {
            for (const scan of revision.machineScans) {
                const bucket = (byEngineVersion[scan.engineVersion] ??= []);
                bucket.push({textId: text.id, revisionId: revision.id});
            }
            return {
                id: revision.id,
                ordinal: revision.ordinal,
                parentId: revision.parentId,
                transitionKind: revision.transitionKind,
                // lift 闸门标记（D1/I5 + revision 维度）：curated/generated 的 rev0 = true，其余 false。
                liftAdmissible: liftAdmissible({originKind: text.originKind, ordinal: revision.ordinal}),
                body: {text: revision.body, charCount: revision.charCount},
                provenanceJson: revision.provenanceJson,
                revealedAt: revision.revealedAt?.toISOString() ?? null,
                createdAt: revision.createdAt.toISOString(),
                machineScans: revision.machineScans.map((scan) => ({
                    id: scan.id,
                    engineVersion: scan.engineVersion,
                    hits: JSON.parse(scan.hitsJson) as MachineScanHitDto[],
                    docScore: scan.docScore,
                    scannedAt: scan.scannedAt.toISOString(),
                })),
                machineDetects: revision.machineDetects.map((detect) => ({
                    id: detect.id,
                    detectorName: detect.detectorName,
                    detectorVersion: detect.detectorVersion,
                    chunkChars: detect.chunkChars,
                    docPAi: detect.docPAi,
                    maxPAi: detect.maxPAi,
                    chunks: JSON.parse(detect.chunksJson) as MachineDetectDto["chunks"],
                    checkedAt: detect.checkedAt.toISOString(),
                })),
                judgments: revision.judgments.map((judgment) => ({
                    id: judgment.id,
                    userId: String(judgment.userId),
                    scores: {
                        aiFlavor: judgment.aiFlavor,
                        wantReadOn: judgment.wantReadOn,
                        improvementScore: judgment.improvementScore,
                    },
                    comment: judgment.comment,
                    phase: revision.ordinal === 0 ? "pre-edit" : "post-edit",
                    blind: judgment.blind,
                    createdAt: judgment.createdAt.toISOString(),
                })),
                annotations: revision.annotations.map((annotation) => ({
                    id: annotation.id,
                    userId: String(annotation.userId),
                    target: revision.ordinal === 0 ? "original" : "edit",
                    span: {start: annotation.start, end: annotation.end},
                    note: annotation.note,
                    createdAt: annotation.createdAt.toISOString(),
                })),
            };
        }),
    }));

    return {texts: exportedTexts, byEngineVersion};
});

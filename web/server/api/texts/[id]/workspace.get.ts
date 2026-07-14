import {requireCurrentUser} from "../../../utils/auth";
import {resolveOwnedText} from "../../../utils/ownership";
import {revisionMachineDto, type MachineDetectDto, type MachineScanDto} from "../../../utils/scan";
import type {MachineLlmReviewDto} from "../../../utils/llm-review";
import type {RevisionAnalysis} from "../../../../shared/analysis";
import type {ClassificationSource, OriginKind, Provenance, TransitionKind, Visibility} from "../../../database/prisma";
import {prisma} from "../../../database/prisma";

/** 工作台恢复：一个 revision 的全量状态（Task 15 P0-B）。 */
export type WorkspaceRevisionDto = {
    revisionId: string;
    ordinal: number;
    /** 血缘软指针；rev0 为 null */
    parentId: string | null;
    body: string;
    charCount: number;
    transitionKind: TransitionKind;
    /** 本次改动的来源聚合（shared/revision-provenance.ts 的 RevisionProvenance JSON）；rev0 或未记录为 null */
    provenanceJson: string | null;
    /** null=未揭示（此时 scan/detects 恒为 null/空，D2） */
    revealedAt: string | null;
    createdAt: string;
    /** 已揭示才带：最近一次引擎扫描；未揭示或（防御）无扫描记录为 null */
    scan: MachineScanDto | null;
    /** 已揭示才带：全部外部检测器结果（含 chunks 热力图）；未揭示恒空数组 */
    detects: MachineDetectDto[];
    /** 已揭示才带：最新一次 LLM 规则评审（Task 17 工单 C）；未揭示恒 null，已揭示但异步未到/通道未配置也为 null */
    llmReview: MachineLlmReviewDto | null;
    /** 已揭示才带三路运行态与评分；未揭示恒 null，防 D2 侧漏。 */
    analysis: RevisionAnalysis | null;
};

/** 工作台恢复：当前用户对某版本的判定（盲评两轴 / 复评四维，整行覆盖语义下的最新态）。 */
export type WorkspaceJudgmentDto = {
    revisionId: string;
    aiFlavor: number | null;
    wantReadOn: number | null;
    improvementScore: number | null;
    comment: string | null;
    blind: boolean;
    createdAt: string;
    updatedAt: string;
};

/** 工作台恢复：当前用户挂在谱系各版本上的 span 标注（span 坐标 = 所挂版本 body 的 UTF-16 半开区间）。 */
export type WorkspaceAnnotationDto = {
    id: string;
    revisionId: string;
    span: {start: number; end: number};
    note: string;
    createdAt: string;
};

/** 工作台恢复响应（Task 15 P0-B）：一次全量，前端 hydrateWorkspace(payload) 重建流程状态。 */
export type WorkspaceResponseDto = {
    /** Text 信封（跨版本不变的元数据） */
    text: {
        textId: string;
        genre: string | null;
        genreSource: ClassificationSource | null;
        pov: string | null;
        povSource: ClassificationSource | null;
        textType: string | null;
        textTypeSource: ClassificationSource | null;
        originKind: OriginKind;
        declaredProvenance: Provenance | null;
        sourceNote: string | null;
        visibility: Visibility;
        consent: boolean;
        createdAt: string;
    };
    /** 谱系全部版本，按 ordinal 升序（最后一个 = head） */
    revisions: WorkspaceRevisionDto[];
    /** 当前用户的判定（每版本至多一条，@@unique(userId, revisionId)） */
    myJudgments: WorkspaceJudgmentDto[];
    /** 当前用户的 span 标注（本端点 owner 才可达，谱系标注即本人标注） */
    annotations: WorkspaceAnnotationDto[];
};

/**
 * 工作台恢复（Task 15 P0-B）：一次全量返回某文本的信封 + 谱系（每版含机器断言）+ 我的判定 + 标注，
 * 供前端从历史列表点入后重建全部流程状态（lineage/head/rev0/scans/detects/submittedScores/postSubmitted）。
 * - owner 校验：非本人或不存在一律 404（不区分，防枚举——resolveOwnedText 同纪律）。
 * - D2 纪律：revealedAt 为 null 的 revision，scan 置 null、detects 置空数组——恢复流程不偷跑机器数据，
 *   前端对未揭示版本仍走 reveal 端点揭示。
 * - 内网量小，不分页。
 */
export default defineEventHandler(async (event): Promise<WorkspaceResponseDto> => {
    const user = await requireCurrentUser(event);
    const textId = getRouterParam(event, "id") ?? "";
    await resolveOwnedText(textId, user.id);

    const text = await prisma.text.findUniqueOrThrow({
        where: {id: textId},
        include: {
            revisions: {
                orderBy: {ordinal: "asc"},
                include: {
                    machineScans: {orderBy: {scannedAt: "asc"}},
                    machineDetects: {orderBy: {checkedAt: "asc"}},
                    machineLlmReviews: {orderBy: {judgedAt: "asc"}},
                    judgments: {where: {userId: user.id}},
                    annotations: {where: {userId: user.id}, orderBy: {createdAt: "asc"}},
                },
            },
        },
    });

    const myJudgments: WorkspaceJudgmentDto[] = [];
    const annotations: WorkspaceAnnotationDto[] = [];
    const revisions = await Promise.all(text.revisions.map(async (revision): Promise<WorkspaceRevisionDto> => {
        for (const judgment of revision.judgments) {
            myJudgments.push({
                revisionId: revision.id,
                aiFlavor: judgment.aiFlavor,
                wantReadOn: judgment.wantReadOn,
                improvementScore: judgment.improvementScore,
                comment: judgment.comment,
                blind: judgment.blind,
                createdAt: judgment.createdAt.toISOString(),
                updatedAt: judgment.updatedAt.toISOString(),
            });
        }
        for (const annotation of revision.annotations) {
            annotations.push({
                id: annotation.id,
                revisionId: revision.id,
                span: {start: annotation.start, end: annotation.end},
                note: annotation.note,
                createdAt: annotation.createdAt.toISOString(),
            });
        }
        const revealed = revision.revealedAt !== null;
        const machine = revealed ? await revisionMachineDto(revision.id) : null;
        return {
            revisionId: revision.id,
            ordinal: revision.ordinal,
            parentId: revision.parentId,
            body: revision.body,
            charCount: revision.charCount,
            transitionKind: revision.transitionKind,
            provenanceJson: revision.provenanceJson,
            revealedAt: revision.revealedAt?.toISOString() ?? null,
            createdAt: revision.createdAt.toISOString(),
            scan: machine?.scan ?? null,
            detects: machine?.detects ?? [],
            llmReview: machine?.llmReview ?? null,
            analysis: machine?.analysis ?? null,
        };
    }));

    return {
        text: {
            textId: text.id,
            genre: text.genre,
            genreSource: text.genreSource,
            pov: text.pov,
            povSource: text.povSource,
            textType: text.textType,
            textTypeSource: text.textTypeSource,
            originKind: text.originKind,
            declaredProvenance: text.declaredProvenance,
            sourceNote: text.sourceNote,
            visibility: text.visibility,
            consent: text.consent,
            createdAt: text.createdAt.toISOString(),
        },
        revisions,
        myJudgments,
        annotations,
    };
});

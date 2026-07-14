// 检测工作台共享类型与派生纯函数（Task 15 P0-A + P1-C）。
// contribute.vue（流程状态宿主）与 ReportPanel.vue（报告 tab 纯展示）共用一份；
// P1-C 历史恢复 hydrateWorkspace(payload) 也在本文件（一次全量 payload → 按 WorkspaceRevision
// 逐项重建谱系/scan/detects/judgment），热力图层类型与配色同源于此。
import type {RevisionAnalysis} from "../../shared/analysis";
import type {LlmAnalysisReport} from "../../shared/agent-harness";

/** 服务器扫描单条命中（reveal / machine 端点返回，UTF-16 span）。 */
export type ServerScanHit = {ruleId: string; span: {start: number; end: number}; level: string; review: string};

/** 服务器引擎扫描（MachineScan DTO；落库真相，浏览器本地扫描只作展示层）。 */
export type ServerScan = {id: string; engineVersion: string; hits: ServerScanHit[]; docScore: number; scannedAt: string};

/** 外部检测器一行（MachineDetect DTO；chunks = 热力图槽位，P1 热力图层消费）。 */
export type ServerDetect = {id: string; detectorName: string; detectorVersion: string; chunkChars: number; docPAi: number; maxPAi: number | null; chunks: Array<{span: {start: number; end: number}; pAi: number}>; checkedAt: string};

/** LLM 规则评审单条命中（Task 17 工单 C）：span = 服务端按 quote 回定位的 UTF-16 区间，null = 定位失败（quote 是唯一位置线索）。 */
export type ServerLlmReviewHit = {ruleId: string; quote: string; reason: string; span: {start: number; end: number} | null};

/** LLM Agent 结构化分析结果。 */
export type ServerLlmReview = {id: string; sessionId: string; invocationId: string; model: string; promptVersion: string; score: number; confidence: number; hits: ServerLlmReviewHit[]; report: LlmAnalysisReport; judgedAt: string};

/** reveal / machine 端点响应形状。llmReview 为 null = 异步评审未到或通道未配置（轮询 machine 端点等落库）。 */
export type RevealResponse = {revisionId: string; revealedAt: string; scan: ServerScan | null; detects: ServerDetect[]; llmReview: ServerLlmReview | null; analysis: RevisionAnalysis};

/** 外部检测器轮询状态：idle=已到/未开始；polling=等待异步落库；exhausted=超限（暂不可用）。 */
export type DetectPollState = "idle" | "polling" | "exhausted";

/** 盲评两轴（rev0，blind=true 的客户端快照；null = 用户跳过打分，无盲评基线）。 */
export type BlindScores = {aiFlavor: number; wantReadOn: number};

/** 复评四维（rev_k 的本会话已提交值；挂在对应 WorkspaceRevision 上）。 */
export type PostJudgment = {aiFlavor: number; wantReadOn: number; improvementScore: number; comment: string};

/** revision 血缘边类型（schema 同名 enum；rev0 恒 upload）。 */
export type WorkspaceTransitionKind = "upload" | "static_fix" | "llm_fix" | "user_fix";

/**
 * 工作台的一个版本条目（版本条 chip / 只读正文 / 报告 tab 的统一数据源）。
 * scan 为空的时机：该版尚未 reveal（rev0 盲评阶段）；detects 为空 = 异步检测未到或不可用（看 detectState）。
 * judgment 为空 = 本会话尚未对该版提交复评（rev0 恒空——rev0 的两轴走盲评通道，不走复评）。
 */
export type WorkspaceRevision = {
    revisionId: string;
    ordinal: number;
    transitionKind: WorkspaceTransitionKind;
    body: string;
    scan: ServerScan | null;
    detects: ServerDetect[];
    /** LLM 规则评审（Task 17 工单 C）；null = 未 reveal / 异步未到 / 通道未配置（展示由工单 D 接） */
    llmReview: ServerLlmReview | null;
    analysis: RevisionAnalysis | null;
    detectState: DetectPollState;
    judgment: PostJudgment | null;
};

/** D5 双条件的各腿判定（rev_k 对 rev0；报告 tab 与完成态总结卡共用同一口径）。 */
export type D5Legs = {
    /** rev0 服务器扫描命中数（基线端；scan 未到按 0 计——正常流程 reveal 后必有）。 */
    rev0Hits: number;
    /** 该版服务器扫描命中数。 */
    revHits: number;
    /** 命中数是否下降（机器腿的降级口径）。 */
    hitsDown: boolean;
    /** 与 rev0 同口径（detectorName/version/chunkChars 全同）的检测配对；缺任一端 = null。 */
    detectPair: {before: ServerDetect; after: ServerDetect} | null;
    /** 检测概率是否下降；null = 无配对数据（机器腿降级为命中口径）。 */
    detectorDown: boolean | null;
    /** 机器信号腿：有配对 → docPAi 下降（升级口径）；否则命中↓（降级口径）。 */
    machineLegPass: boolean;
    /** 想追更未降；null = 无盲评基线或该版未提交复评（人评腿不可判）。 */
    wantReadOnKept: boolean | null;
};

/**
 * 在两版检测行里找同口径配对（detectorName + detectorVersion + chunkChars 全同才可比，跨口径不可比）。
 */
export function findDetectPair(baseline: ServerDetect[], current: ServerDetect[]): {before: ServerDetect; after: ServerDetect} | null {
    for (const after of current) {
        const before = baseline.find((item) => item.detectorName === after.detectorName && item.detectorVersion === after.detectorVersion && item.chunkChars === after.chunkChars);
        if (before) {
            return {before, after};
        }
    }
    return null;
}

/**
 * 计算某个 rev_k(k≥1) 对 rev0 的 D5 各腿（口径与 Task 13 verdict 屏一字不差）：
 * 机器腿 = 检测概率降（两端有同口径数据）| 命中↓（降级）；人评腿 = 想追更不降（无盲评基线不可判）。
 * D5 三态（通过/未通过/无基线仅机器腿）由消费方按 wantReadOnKept 是否为 null 折算。
 */
export function computeD5Legs(rev0: WorkspaceRevision, rev: WorkspaceRevision, blind: BlindScores | null, judgment: PostJudgment | null): D5Legs {
    const rev0Hits = rev0.scan?.hits.length ?? 0;
    const revHits = rev.scan?.hits.length ?? 0;
    const hitsDown = revHits < rev0Hits;
    const detectPair = findDetectPair(rev0.detects, rev.detects);
    const detectorDown = detectPair === null ? null : detectPair.after.docPAi < detectPair.before.docPAi;
    return {
        rev0Hits,
        revHits,
        hitsDown,
        detectPair,
        detectorDown,
        machineLegPass: detectorDown !== null ? detectorDown : hitsDown,
        wantReadOnKept: blind === null || judgment === null ? null : judgment.wantReadOn >= blind.wantReadOn,
    };
}

/** P(AI) 百分数显示（0.923 → "92.3"）。 */
export function pAiPercent(value: number): string {
    return (value * 100).toFixed(1);
}

// ═══════════════ 报告汇总（Task 16 R8：说人话统计） ═══════════════

/** summarizeScanHits 的规则元数据（宿主从 useLlmlint 的 baseRegistry / registry 组装）。 */
export type ScanHitsMeta = {
    /**
     * 规则判别裁决字典（构建期烘焙 registry.ruleVerdicts）。
     * undefined = 本次构建缺评测报告 → strongHits 记 null，UI 不显示强判别行（D-D 降级口径）。
     */
    verdicts?: Record<string, {verdict: string}>;
    /** 可自动修复规则 id 集（fixability=auto 且 action.type=replace，按全量目录判据）。 */
    autoRuleIds: Set<string>;
    /** 用户当前生效规则 id 集（materialized registry，含 ruleOverrides/namespaceOverrides 过滤）。 */
    activeRuleIds: Set<string>;
    /** 全量目录默认生效规则 id 集；「用户隐藏」判据 = ∈catalog 且 ∉active（默认 disabled 的不算隐藏）。 */
    catalogRuleIds: Set<string>;
};

/** 报告 tab 汇总卡的统计结果（全部按服务器落库 hits 全量口径，隐藏规则只注明不剔除——拍板①）。 */
export type ScanHitsSummary = {
    /** 总命中数。 */
    total: number;
    /** 按严重级别分桶（未知 level 不计入任何桶，但计入 total）。 */
    byLevel: {high: number; medium: number; low: number};
    /** 强判别规则的命中数；null = 报告缺失（verdicts 未烘焙），不可判。 */
    strongHits: number | null;
    /** 可自动修复的命中数（一键/批量应用可消掉的量级）。 */
    autoFixableHits: number;
    /** 来自「用户隐藏的规则」的命中数（编辑器/命中列表看不到，但落库统计保持全量）。 */
    hiddenHits: number;
};

/**
 * 汇总服务器扫描 hits 为报告 tab 的白话统计（Task 16 R8）：
 * 逐 hit 按 ruleId join 规则元数据——强判别命中 / 可自动修复命中 / 隐藏规则命中。
 * hits 来自落库 MachineScan（采集真相），ruleId 可能已不在当前构建的全量目录
 * （规则改名/删除的历史数据）：这类既不算隐藏也不算强判别，只进 total/byLevel。
 */
export function summarizeScanHits(hits: ServerScanHit[], meta: ScanHitsMeta): ScanHitsSummary {
    const byLevel = {high: 0, medium: 0, low: 0};
    let strongHits = 0;
    let autoFixableHits = 0;
    let hiddenHits = 0;
    for (const hit of hits) {
        if (hit.level === "high" || hit.level === "medium" || hit.level === "low") {
            byLevel[hit.level] += 1;
        }
        if (meta.verdicts?.[hit.ruleId]?.verdict === "strong") {
            strongHits += 1;
        }
        if (meta.autoRuleIds.has(hit.ruleId)) {
            autoFixableHits += 1;
        }
        if (meta.catalogRuleIds.has(hit.ruleId) && !meta.activeRuleIds.has(hit.ruleId)) {
            hiddenHits += 1;
        }
    }
    return {
        total: hits.length,
        byLevel,
        strongHits: meta.verdicts === undefined ? null : strongHits,
        autoFixableHits,
        hiddenHits,
    };
}

// ═══════════════ 热力图（Task 15 P1-C：挂版本不挂草稿） ═══════════════

/** 热力块：某版本 body 上的 UTF-16 半开区间 + 该块检测概率（来自 MachineDetect.chunks）。 */
export type HeatChunk = {start: number; end: number; pAi: number};

/**
 * P(AI) → 梯度底色：0 绿（像人）→ 1 红（像 AI），HSL 色相 120→0 线性插值。
 * 只读正文铺底色用低 alpha（不压文字），报告缩略条用高 alpha（色块本身即内容）。
 */
export function heatColor(pAi: number, alpha = 0.3): string {
    const clamped = Math.max(0, Math.min(1, pAi));
    return `hsla(${Math.round(120 * (1 - clamped))}, 85%, 45%, ${alpha})`;
}

// ═══════════════ 历史恢复（Task 15 P1-C：hydrateWorkspace） ═══════════════

/** GET /api/texts 历史列表一行（服务端 TextHistoryItemDto 的镜像，见 web/server/api/texts.get.ts）。 */
export type TextHistoryItem = {
    textId: string;
    /** 列表摘要：sourceNote（作品名）优先，否则 rev0 正文压空白后的前 30 字。 */
    preview: string;
    createdAt: string;
    /** 谱系版本数（含 rev0）。 */
    revisionCount: number;
    /** 最新版本 ordinal（= head）。 */
    latestOrdinal: number;
    /** head 已揭示且有扫描才为数值，否则 null（D2：未揭示不带任何机器数据）。 */
    latestDocScore: number | null;
};

/** 工作台恢复端点里前端消费的 revision 字段（服务端 WorkspaceRevisionDto 的子集镜像）。 */
export type WorkspaceRevisionPayload = {
    revisionId: string;
    ordinal: number;
    body: string;
    transitionKind: WorkspaceTransitionKind;
    /** null = 未揭示（D2：此时 scan 恒 null、detects 恒空，恢复流程不偷跑机器数据）。 */
    revealedAt: string | null;
    scan: ServerScan | null;
    detects: ServerDetect[];
    /** null = 未揭示（D2）或已揭示但评审未到/通道未配置。 */
    llmReview: ServerLlmReview | null;
    analysis: RevisionAnalysis | null;
};

/** 我的判定一行（盲评两轴 / 复评四维；每版至多一条，服务端 WorkspaceJudgmentDto 子集）。 */
export type WorkspaceJudgmentPayload = {
    revisionId: string;
    aiFlavor: number | null;
    wantReadOn: number | null;
    improvementScore: number | null;
    comment: string | null;
    blind: boolean;
};

/** GET /api/texts/:id/workspace 响应中前端消费的子集（服务端 WorkspaceResponseDto，结构化兼容）。 */
export type WorkspacePayload = {
    text: {textId: string};
    /** 谱系全部版本，按 ordinal 升序（末位 = head）。 */
    revisions: WorkspaceRevisionPayload[];
    myJudgments: WorkspaceJudgmentPayload[];
    /** 当前用户的 span 标注（恢复后只做条数计数，正文标注实体由服务端持有）。 */
    annotations: Array<{id: string; revisionId: string}>;
};

/** hydrateWorkspace 的产物：宿主页面按字段逐项覆盖工作台 refs。 */
export type HydratedWorkspace = {
    textId: string;
    revisions: WorkspaceRevision[];
    /** rev0.revealedAt 非空 = 已揭示（盲评已交或已跳过）。 */
    revealed: boolean;
    /** rev0 的盲评两轴（blind=true 判定）；无 = 当时跳过打分（D5 人评腿不可判）。 */
    submittedScores: BlindScores | null;
    /** 编辑草稿基底 = head 正文。 */
    editDraft: string;
    /** 恢复后查看指针停在 head（报告 tab 默认展示最新版）。 */
    activeOrdinal: number;
    /** 本篇已有标注条数（G6 总结卡轻量计数的恢复值）。 */
    annotationCount: number;
};

/**
 * 从工作台恢复端点的全量 payload 重建前端流程状态（Task 15 P1-C 历史恢复）：
 * - revisions 按 WorkspaceRevision 形状逐项映射，detectState 一律回 "idle"（缺检测数据由宿主按需补轮询）；
 * - rev0 的 blind=true 判定 → submittedScores（盲评基线）；rev_k 的非盲四维齐全判定 → 该版 judgment
 *   （表单锁定 + D5 出现）；四维不全或挂错版本的判定按未提交处理（防御，不冒充）；
 * - editDraft = head 正文（拍板②：编辑恒基于最新版）。
 */
export function hydrateWorkspace(payload: WorkspacePayload): HydratedWorkspace {
    const judgmentByRevision = new Map(payload.myJudgments.map((judgment) => [judgment.revisionId, judgment]));
    const revisions = payload.revisions.map((revision): WorkspaceRevision => {
        const judgment = judgmentByRevision.get(revision.revisionId) ?? null;
        // 复评四维只认 rev_k(k≥1) 的非盲、四维齐全判定（rev0 两轴走盲评通道，不进复评表单）。
        const post: PostJudgment | null = revision.ordinal >= 1 && judgment !== null && !judgment.blind
            && judgment.aiFlavor !== null && judgment.wantReadOn !== null && judgment.improvementScore !== null
            ? {aiFlavor: judgment.aiFlavor, wantReadOn: judgment.wantReadOn, improvementScore: judgment.improvementScore, comment: judgment.comment ?? ""}
            : null;
        return {
            revisionId: revision.revisionId,
            ordinal: revision.ordinal,
            transitionKind: revision.transitionKind,
            body: revision.body,
            scan: revision.scan,
            detects: revision.detects,
            llmReview: revision.llmReview,
            analysis: revision.analysis,
            detectState: "idle",
            judgment: post,
        };
    });
    const rev0 = payload.revisions[0] ?? null;
    const rev0Judgment = rev0 === null ? null : judgmentByRevision.get(rev0.revisionId) ?? null;
    // 盲评基线：rev0 的 blind=true 判定且两轴齐全（跳过打分或脏数据 → null，无基线）。
    const blind: BlindScores | null = rev0Judgment !== null && rev0Judgment.blind
        && rev0Judgment.aiFlavor !== null && rev0Judgment.wantReadOn !== null
        ? {aiFlavor: rev0Judgment.aiFlavor, wantReadOn: rev0Judgment.wantReadOn}
        : null;
    const head = revisions[revisions.length - 1] ?? null;
    return {
        textId: payload.text.textId,
        revisions,
        revealed: rev0 !== null && rev0.revealedAt !== null,
        submittedScores: blind,
        editDraft: head?.body ?? "",
        activeOrdinal: head?.ordinal ?? 0,
        annotationCount: payload.annotations.length,
    };
}

/** 异步小睡（detect / llm-fix 轮询共用）。 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

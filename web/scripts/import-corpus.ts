#!/usr/bin/env bun
// 语料导入：evals corpus → web 库（Task 13 W5；照 Task 12「evals 语料 ↔ 本模型的映射」表）。
// 用法：cd web && [DATABASE_URL=file:./data.db] bun scripts/import-corpus.ts \
//         [--corpus <dir>] [--genre <题材目录>] [--plot <题组目录>] [--limit <最多处理题组数>] [--dry]
//
// 映射（Task 12）：
// - role:reference → Text{originKind=curated, sourceNote=书名/章节, genre=题组目录名(genreSource=curator)} + rev0(upload)
// - role:render    → Text{originKind=generated, modelKey=meta.model, genParamsJson={briefVersion, renderPromptVersion, sourceRef=pairRef}} + rev0(upload)
// - role:repair    → 按 repairOf 找到源 render 的 Text，挂为其后继 revision（transitionKind=llm_fix），不建新 Text
// 每个导入的 revision 同步跑服务端扫描（recordMachineScan，与 web 上传通路同一口径）。
//
// I11 合规：curated 版权正文绝不进公开池——visibility 硬编码 private，不设参数开关（generated 同样 private，
// 语料是研究资产不是众评内容）。consent 是"上传者勾选采集协议"的用户流语义，系统导入不适用，恒 false。
//
// 幂等：每个导入 revision 的 provenanceJson 携带 corpusKey（`genre/plotId/file`，语料内全局唯一），
// 重跑按 corpusKey 查到已导入即跳过（不重复导入）。选它做去重键的原因：三种 role（两种建 Text、一种建
// 后继 revision）都能用同一个 rev 级键覆盖，且 JSON.stringify 产出的 `"corpusKey":"..."` 子串可被
// SQLite contains 精确检索，无需加列。
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {createHash, randomBytes} from "node:crypto";
import {prisma} from "../server/database/prisma";
import type {ClassificationSource} from "../server/database/prisma";
import {recordMachineScan} from "../server/utils/scan";
import {visibleCharCount} from "../server/utils/dto";
import {hashUserPassword} from "../server/utils/password";

// —— meta.json 的原始形状（与 evals/lib/corpus.ts 的宽松口径一致：缺字段降级、坏样本跳过并告警）——

type RawSampleMeta = {
    file?: string;
    role?: string;
    model?: string; // render=生成模型；repair=修复模型
    pairRef?: string; // render 指回本章 reference 文件名
    repairOf?: string; // repair 指回源 render 文件名
    title?: string; // reference：书名+章节
    sourceFile?: string; // reference：切书来源文件
    promptVersion?: {repair?: string}; // repair 样本级：修复 prompt 版本
};

type RawGroupMeta = {
    genre?: string;
    plotId?: string;
    author?: string; // reference 作者（拼 sourceNote 用）
    promptVersion?: {brief?: string; render?: string};
    // 分类 agent 补空产物（Task 12 文本分类）：source 恒 llm；值已过白名单校验，导入侧不再重验。
    classification?: {source?: string; pov?: string; textType?: string};
    samples?: RawSampleMeta[];
};

type ImportStats = {curated: number; generated: number; repair: number; skipped: number; orphans: number};

const {values: args} = parseArgs({
    options: {
        corpus: {type: "string"},
        genre: {type: "string"},
        plot: {type: "string"},
        limit: {type: "string"},
        dry: {type: "boolean", default: false},
    },
});

// 默认语料目录 = 仓内 evals/corpus（相对本脚本定位，cwd 无关，同 evals I10 纪律）。
const corpusRoot = resolve(args.corpus ?? join(import.meta.dir, "../../evals/corpus"));
const dry = args.dry ?? false;
const groupLimit = args.limit === undefined ? Number.POSITIVE_INFINITY : Number.parseInt(args.limit, 10);

/** 列出目录下的子目录名（排序保证确定性）。 */
function listDirs(root: string): string[] {
    return readdirSync(root, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

/** corpusKey 兼作幂等键并以子串方式检索，含引号/反斜杠会破坏检索精度——语料路径不应出现，出现即硬失败。 */
function ensureSafeKey(corpusKey: string): void {
    if (corpusKey.includes('"') || corpusKey.includes("\\")) {
        throw new Error(`corpusKey 含非法字符（引号/反斜杠）：${corpusKey}`);
    }
}

/** 已导入检索：rev 级 provenanceJson 里的 `"corpusKey":"..."` 子串（JSON.stringify 无空格，子串精确）。 */
async function findImported(corpusKey: string): Promise<{id: string; textId: string} | null> {
    return prisma.revision.findFirst({
        where: {provenanceJson: {contains: `"corpusKey":"${corpusKey}"`}},
        select: {id: true, textId: true},
    });
}

/**
 * 幂等获取语料导入系统账号：username=corpus-import、role=admin。
 * 密码为一次性随机值且不打印、不落盘——该账号只作导入数据的 uploader 归属，不用于登录。
 */
async function ensureImporter(): Promise<{id: number}> {
    const existing = await prisma.user.findUnique({where: {username: "corpus-import"}, select: {id: true}});
    if (existing) {
        return existing;
    }
    return prisma.user.create({
        data: {
            username: "corpus-import",
            displayName: "语料导入系统账号",
            passwordHash: await hashUserPassword(randomBytes(32).toString("hex")),
            role: "admin",
        },
        select: {id: true},
    });
}

/** meta.classification 的 pov/textType 转 (值, 来源) 对：值缺失或 unknown 留空（宁缺勿错），来源随 meta（预期 llm）。 */
function classificationOf(meta: RawGroupMeta): {pov: string | null; textType: string | null; source: ClassificationSource | null} {
    const source = meta.classification?.source;
    const mapped: ClassificationSource | null = source === "curator" || source === "user" || source === "llm" ? source : null;
    const pick = (value: string | undefined): string | null => (value && value !== "unknown" ? value : null);
    return {pov: pick(meta.classification?.pov), textType: pick(meta.classification?.textType), source: mapped};
}

async function main(): Promise<void> {
    if (!existsSync(corpusRoot) || !statSync(corpusRoot).isDirectory()) {
        throw new Error(`语料目录不存在或不是目录：${corpusRoot}`);
    }

    // 组装待处理题组（--genre / --plot 过滤，--limit 截断）。
    const groups: Array<{genre: string; plotId: string; dir: string}> = [];
    for (const genre of listDirs(corpusRoot)) {
        if (args.genre && genre !== args.genre) {
            continue;
        }
        for (const plotId of listDirs(join(corpusRoot, genre))) {
            if (args.plot && plotId !== args.plot) {
                continue;
            }
            groups.push({genre, plotId, dir: join(corpusRoot, genre, plotId)});
        }
    }
    const limited = groups.slice(0, groupLimit);
    if (limited.length === 0) {
        throw new Error(`没有匹配的题组（corpus=${corpusRoot}, genre=${args.genre ?? "*"}, plot=${args.plot ?? "*"}）`);
    }
    console.log(`${dry ? "[dry] " : ""}待处理题组 ${limited.length}/${groups.length}：${limited.map((g) => `${g.genre}/${g.plotId}`).join("、")}`);

    const importer = dry ? null : await ensureImporter();
    if (dry) {
        console.log("[dry] 将确保系统账号 corpus-import（role=admin）存在");
    }

    const stats: ImportStats = {curated: 0, generated: 0, repair: 0, skipped: 0, orphans: 0};
    // dry 模式下"本轮计划新建"的 corpusKey 集合：让 repair 能解析到同轮计划中的 render。
    const plannedKeys = new Set<string>();

    for (const group of limited) {
        const metaPath = join(group.dir, "meta.json");
        if (!existsSync(metaPath)) {
            console.warn(`跳过 ${group.genre}/${group.plotId}：缺 meta.json`);
            continue;
        }
        const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as RawGroupMeta;
        if (meta.genre && meta.genre !== group.genre) {
            console.warn(`⚠ ${group.genre}/${group.plotId}：meta.genre=${meta.genre} 与目录名不一致，按目录名导入（映射表口径）`);
        }
        const classification = classificationOf(meta);
        const samples = meta.samples ?? [];

        // 第一遍：reference / render 建 Text + rev0（repair 需要 render 先在库里）。
        for (const sample of samples) {
            if (sample.role !== "reference" && sample.role !== "render") {
                continue;
            }
            if (!sample.file) {
                console.warn(`⚠ ${group.genre}/${group.plotId}：样本缺 file，跳过`);
                continue;
            }
            const corpusKey = `${group.genre}/${group.plotId}/${sample.file}`;
            ensureSafeKey(corpusKey);
            if (await findImported(corpusKey)) {
                stats.skipped += 1;
                continue;
            }
            const absPath = join(group.dir, sample.file);
            if (!existsSync(absPath)) {
                console.warn(`⚠ ${corpusKey}：文件不存在，跳过`);
                continue;
            }
            const body = readFileSync(absPath, "utf-8");
            const isReference = sample.role === "reference";
            // curated 的 sourceNote＝书名/章节来处（必填语义）：title｜author｜sourceFile 拼接，全缺时退回 corpusKey。
            const sourceNote = isReference
                ? [sample.title, meta.author, sample.sourceFile].filter(Boolean).join("｜") || corpusKey
                : null;
            // generated 的生成参数（schema 注释口径：briefVersion / renderPromptVersion / sourceRef=pairRef 指回 reference）。
            const genParamsJson = isReference
                ? null
                : JSON.stringify({
                    briefVersion: meta.promptVersion?.brief ?? null,
                    renderPromptVersion: meta.promptVersion?.render ?? null,
                    sourceRef: sample.pairRef ?? null,
                });

            if (dry) {
                console.log(`[dry] ${isReference ? "curated " : "generated"} ${corpusKey} → 新建 Text+rev0+MachineScan`);
                plannedKeys.add(corpusKey);
                stats[isReference ? "curated" : "generated"] += 1;
                continue;
            }
            const text = await prisma.text.create({
                data: {
                    genre: group.genre, // 题组目录名即题材（映射表口径）
                    genreSource: "curator", // 目录结构是人工策展的产物
                    pov: classification.pov,
                    povSource: classification.pov === null ? null : classification.source,
                    textType: classification.textType,
                    textTypeSource: classification.textType === null ? null : classification.source,
                    originKind: isReference ? "curated" : "generated",
                    declaredProvenance: null, // 仅 uploaded 变体使用；ground-truth 由 originKind 派生
                    sourceNote,
                    modelKey: isReference ? null : sample.model ?? null,
                    genParamsJson,
                    uploaderId: importer!.id,
                    visibility: "private", // I11：curated 版权正文绝不进公开池；硬编码，不设开关
                    consent: false, // 系统导入无"上传者勾选"语义
                    revisions: {
                        create: {
                            ordinal: 0,
                            parentId: null,
                            body,
                            charCount: visibleCharCount(body),
                            transitionKind: "upload",
                            provenanceJson: JSON.stringify({
                                importSource: "evals-corpus",
                                corpusKey,
                                bodySha256: createHash("sha256").update(body).digest("hex"),
                            }),
                        },
                    },
                },
                include: {revisions: true},
            });
            const rev0 = text.revisions[0];
            if (!rev0) {
                throw new Error(`创建 rev0 失败：${corpusKey}`);
            }
            await recordMachineScan(rev0.id, body);
            stats[isReference ? "curated" : "generated"] += 1;
        }

        // 第二遍：repair 挂为源 render Text 的后继 revision（血缘：parent=render rev0）。
        for (const sample of samples) {
            if (sample.role !== "repair") {
                continue;
            }
            if (!sample.file || !sample.repairOf) {
                console.warn(`⚠ ${group.genre}/${group.plotId}/${sample.file ?? "?"}：repair 缺 file/repairOf，跳过（孤儿）`);
                stats.orphans += 1;
                continue;
            }
            const corpusKey = `${group.genre}/${group.plotId}/${sample.file}`;
            ensureSafeKey(corpusKey);
            if (await findImported(corpusKey)) {
                stats.skipped += 1;
                continue;
            }
            const renderKey = `${group.genre}/${group.plotId}/${sample.repairOf}`;
            const renderRev = await findImported(renderKey);
            if (!renderRev && !(dry && plannedKeys.has(renderKey))) {
                console.warn(`⚠ ${corpusKey}：找不到源 render（${renderKey}），跳过（孤儿）`);
                stats.orphans += 1;
                continue;
            }
            const absPath = join(group.dir, sample.file);
            if (!existsSync(absPath)) {
                console.warn(`⚠ ${corpusKey}：文件不存在，跳过`);
                continue;
            }
            if (dry) {
                console.log(`[dry] repair    ${corpusKey} → 挂为 ${renderKey} 的后继 revision（llm_fix）+MachineScan`);
                stats.repair += 1;
                continue;
            }
            const body = readFileSync(absPath, "utf-8");
            // ordinal 与 revisions.post 同规：文档内最大值 +1（导入场景 render 只有 rev0，即 rev1）。
            const max = await prisma.revision.aggregate({where: {textId: renderRev!.textId}, _max: {ordinal: true}});
            const revision = await prisma.revision.create({
                data: {
                    textId: renderRev!.textId,
                    parentId: renderRev!.id,
                    ordinal: (max._max.ordinal ?? -1) + 1,
                    body,
                    charCount: visibleCharCount(body),
                    transitionKind: "llm_fix", // 映射表：repair = llm 洗稿产物
                    provenanceJson: JSON.stringify({
                        importSource: "evals-corpus",
                        corpusKey,
                        bodySha256: createHash("sha256").update(body).digest("hex"),
                        repairModel: sample.model ?? null,
                        repairPromptVersion: sample.promptVersion?.repair ?? null,
                    }),
                },
            });
            await recordMachineScan(revision.id, body);
            stats.repair += 1;
        }
    }

    console.log(
        `${dry ? "[dry] " : ""}导入完成：curated ${stats.curated}｜generated ${stats.generated}｜repair ${stats.repair}` +
            `｜已存在跳过 ${stats.skipped}｜孤儿 ${stats.orphans}`,
    );
}

try {
    await main();
} finally {
    await prisma.$disconnect();
}

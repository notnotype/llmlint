// 元评测各实验共用的语料读写。
//
// 为什么单独一个模块：`guide-arm.ts` / `delivery-arm.ts` 末尾都自执行 `parseAsync(process.argv)`，
// 从其中一个 import 另一个会直接触发它跑起来（`generate.ts` 已经踩过这个坑，见 resolve-model.ts）。
// 所以两侧共用的部分放在这里，脚本只保留自己的臂定义与调用逻辑。
import {existsSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {visibleLength} from "../lib/corpus";
import {loadRules} from "../../skill/src/rules";
import {buildGuideArtifact, GUIDE_TIERS, parseRuleVerdicts, type GuideArtifact, type GuideProvenance, type GuideTier, type RuleVerdicts} from "../../skill/src/guide";

/** 一个实验样本在 meta.json 里的记录。字段与主语料同形，这样 detect.ts / lib/corpus 能直接消费。 */
export type SampleMeta = {
    file: string;
    role: string;
    model: string;
    promptVersion: string;
    /** 配对锚点：同一个 pairRef 的多个臂互为一对。 */
    pairRef: string;
    /** 臂标识。`guide-compare --arms` 按它取臂。 */
    styleKey: string;
    /** 自由文本，记这一臂到底做了什么（如 `llmlint-guide-standard` / `sysprompt`）。 */
    difficulty: string;
    charCount: number;
};

export type GroupMeta = {
    genre: string;
    plotId: string;
    promptVersion: {render: string};
    /** 实验输入是否满足本实验的受控变量合同；比较器在读样本前硬切校验。 */
    validity: ExperimentValidity;
    /** 本批实际注入的 guide 来源；旧实验或 control-only 批次可以没有。 */
    guide?: GuideProvenance;
    samples: SampleMeta[];
};

export type ExperimentValidity =
    | {status: "valid"}
    | {status: "invalid"; reason: string};

/** 主语料里一个「有 brief 的 reference」，是实验两臂共享的输入。 */
export type RefEntry = {
    file: string;
    idx: string;
    briefPath: string;
    /** 目标字数 = 人类原章的可见字数，让实验产物与人类样本篇幅可比。 */
    targetChars: number;
};

/** 列出主语料下所有 (题材, 剧情) 题组。 */
export function listGroups(corpusRoot: string): Array<{genre: string; plot: string}> {
    const groups: Array<{genre: string; plot: string}> = [];
    for (const genre of listDirs(corpusRoot)) {
        for (const plot of listDirs(join(corpusRoot, genre))) {
            groups.push({genre, plot});
        }
    }
    return groups;
}

/**
 * 取一个题组里「有 brief 的 reference」。
 *
 * 只用已有 brief，不重新抽取：brief 是各臂共享的输入，重抽会引入第二个变量（I3 配对同源）。
 */
export function refsOf(corpusRoot: string, group: {genre: string; plot: string}): RefEntry[] {
    const dir = join(corpusRoot, group.genre, group.plot);
    const metaPath = join(dir, "meta.json");
    if (!existsSync(metaPath)) {
        return [];
    }
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {samples?: Array<{file?: string; role?: string}>};
    const refs: RefEntry[] = [];
    for (const sample of meta.samples ?? []) {
        if (sample.role !== "reference" || !sample.file) {
            continue;
        }
        const idx = sample.file.replace(/^reference-/, "").replace(/\.md$/, "");
        const briefPath = join(dir, `brief-${idx}.md`);
        if (!existsSync(briefPath)) {
            continue;
        }
        refs.push({file: sample.file, idx, briefPath, targetChars: visibleLength(readFileSync(join(dir, sample.file), "utf-8"))});
    }
    return refs;
}

export function readGroupMeta(dir: string): GroupMeta | null {
    const path = join(dir, "meta.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) as GroupMeta : null;
}

/** 每写一个样本就落一次 meta：中途失败/中断时已生成的样本不会变成没有 meta 的孤儿文件。 */
export function writeGroupMeta(dir: string, genre: string, plotId: string, renderVersion: string, guide: GuideProvenance | undefined, samples: SampleMeta[]): void {
    const meta: GroupMeta = {genre, plotId, promptVersion: {render: renderVersion}, validity: {status: "valid"}, ...(guide ? {guide} : {}), samples};
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

/**
 * 构建写作约束正文。
 *
 * @param profilePath eval 报告路径。不传 = 判别力档位不带证据（I24：verdict 不进 skill 包，
 *   `core` 只剩语义规则、`wide` 等同 `standard`），刻意不假装有证据。
 */
export async function buildExperimentGuide(tier: GuideTier, profilePath?: string): Promise<GuideArtifact> {
    const loaded = await loadRules({rulesets: ["builtin/default"], trustedRulesets: [], rulesetOverrides: {}, namespaces: {}, rules: {}, ignoreTerms: [], output: "json"});
    let verdicts: RuleVerdicts = new Map();
    if (profilePath !== undefined) {
        const path = resolve(profilePath);
        if (!existsSync(path)) {
            throw new Error(`profile 报告不存在：${profilePath}`);
        }
        verdicts = parseRuleVerdicts(readFileSync(path, "utf-8"));
    }
    return buildGuideArtifact(loaded, tier, verdicts, profilePath !== undefined);
}

/** 比较全部 provenance 字段；任何旧形态、缺字段或指纹漂移都在扫描/生成前失败。 */
export function assertGuideProvenance(actual: unknown, expected: GuideProvenance, context: string): asserts actual is GuideProvenance {
    if (!isObject(actual)) {
        throw new Error(`${context} 缺少 guide provenance；期望 ${JSON.stringify(expected)}。`);
    }
    const fields: Array<keyof GuideProvenance> = ["tier", "profileFingerprint", "selectedRuleFingerprint", "selectedRuleCount", "textFingerprint"];
    const differences = fields.flatMap((field) => actual[field] === expected[field]
        ? []
        : [`${field}: 期望 ${JSON.stringify(expected[field])}，实际 ${JSON.stringify(actual[field])}`]);
    const fingerprints = [actual.profileFingerprint, actual.selectedRuleFingerprint, actual.textFingerprint]
        .filter((value): value is string => typeof value === "string");
    if (fingerprints.some((value) => !/^sha256:[0-9a-f]{64}$/.test(value))) {
        differences.push("指纹必须是 sha256:<64 lowercase hex>");
    }
    if (differences.length > 0) {
        throw new Error(`${context} guide provenance 不一致：\n  ${differences.join("\n  ")}`);
    }
}

/** validity 是 guide provenance 之前的实验资格门；旧形态与 invalid 都不能进入扫描。 */
export function assertExperimentValidity(actual: unknown, context: string): asserts actual is {status: "valid"} {
    if (!isObject(actual) || actual.status !== "valid" || Object.keys(actual).length !== 1) {
        if (isObject(actual) && actual.status === "invalid" && typeof actual.reason === "string" && actual.reason.trim().length > 0) {
            throw new Error(`${context} 实验已标记 invalid：${actual.reason}`);
        }
        throw new Error(`${context} 缺少合法 validity；期望 {"status":"valid"}。`);
    }
}

/** 严格核对实验根下每个非空题组的 meta；必须在 loadCorpus/scanAll 前调用。 */
export function verifyExperimentGuide(root: string, expected: GuideProvenance): void {
    for (const group of listGroups(root)) {
        const groupDir = join(root, group.genre, group.plot);
        const files = readdirSync(groupDir, {withFileTypes: true}).filter((entry) => entry.isFile());
        const meta = readGroupMeta(groupDir);
        if (!meta) {
            if (files.length > 0) {
                throw new Error(`${group.genre}/${group.plot}/meta.json 缺失；非空实验题组不能跳过 provenance 守门。`);
            }
            continue;
        }
        assertExperimentValidity(meta.validity, `${group.genre}/${group.plot}/meta.json`);
        assertGuideProvenance(meta.guide, expected, `${group.genre}/${group.plot}/meta.json`);
    }
}

export function resolveTier(tier: string): GuideTier {
    if (!GUIDE_TIERS.includes(tier as GuideTier)) {
        throw new Error(`档位无效：${tier}。合法值：${GUIDE_TIERS.join("、")}`);
    }
    return tier as GuideTier;
}

function listDirs(root: string): string[] {
    if (!existsSync(root)) {
        throw new Error(`目录不存在：${root}`);
    }
    return readdirSync(root, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

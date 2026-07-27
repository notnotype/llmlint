// 元评测各实验共用的语料读写。
//
// 为什么单独一个模块：`guide-arm.ts` / `delivery-arm.ts` 末尾都自执行 `parseAsync(process.argv)`，
// 从其中一个 import 另一个会直接触发它跑起来（`generate.ts` 已经踩过这个坑，见 resolve-model.ts）。
// 所以两侧共用的部分放在这里，脚本只保留自己的臂定义与调用逻辑。
import {existsSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {visibleLength} from "../lib/corpus";
import {loadRules} from "../../skill/src/rules";
import {buildGuide, GUIDE_TIERS, parseRuleVerdicts, type GuideTier, type RuleVerdicts} from "../../skill/src/guide";

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
    /** 本批用的写作约束档位；control-only 的批次可以没有。 */
    guideTier?: GuideTier;
    samples: SampleMeta[];
};

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
export function writeGroupMeta(dir: string, genre: string, plotId: string, renderVersion: string, guideTier: GuideTier | undefined, samples: SampleMeta[]): void {
    const meta: GroupMeta = {genre, plotId, promptVersion: {render: renderVersion}, guideTier, samples};
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

/**
 * 构建写作约束正文。
 *
 * @param profilePath eval 报告路径。不传 = 判别力档位不带证据（I24：verdict 不进 skill 包，
 *   `core` 只剩语义规则、`wide` 等同 `standard`），刻意不假装有证据。
 */
export async function buildGuideText(tier: GuideTier, profilePath?: string): Promise<string> {
    const loaded = await loadRules({rulesets: ["builtin/default"], trustedRulesets: [], rulesetOverrides: {}, namespaces: {}, rules: {}, ignoreTerms: [], output: "json"});
    let verdicts: RuleVerdicts = new Map();
    if (profilePath !== undefined) {
        const path = resolve(profilePath);
        if (!existsSync(path)) {
            throw new Error(`profile 报告不存在：${profilePath}`);
        }
        verdicts = parseRuleVerdicts(readFileSync(path, "utf-8"));
    }
    return buildGuide(loaded, tier, verdicts);
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

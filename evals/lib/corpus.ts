// 读取并校验语料目录：<corpus>/<genre>/<plot-id>/{meta.json, *.md}。
// 对"非自产语料"稳健：缺字段降级、孤儿文件跳过并告警。允许只有 reference 的题组。
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import type {Sample, SampleRole} from "./types";

type RawSampleMeta = {
    file?: string;
    role?: string;
    model?: string;
    modelVersion?: string;
    styleKey?: string;
    difficulty?: string;
    promptVersion?: string;
    split?: string;
    referenceSource?: string;
    pairRef?: string;
};

type RawGroupMeta = {genre?: string; plotId?: string; samples?: RawSampleMeta[]};

export type LoadCorpusResult = {samples: Sample[]; warnings: string[]};

const VALID_ROLES: SampleRole[] = ["reference", "render", "repair"];

/** 加载整个语料目录为扁平 Sample[]。 */
export function loadCorpus(corpusRoot: string): LoadCorpusResult {
    if (!existsSync(corpusRoot) || !statSync(corpusRoot).isDirectory()) {
        throw new Error(`语料目录不存在或不是目录：${corpusRoot}`);
    }
    const samples: Sample[] = [];
    const warnings: string[] = [];

    for (const genre of listDirs(corpusRoot)) {
        for (const plotId of listDirs(join(corpusRoot, genre))) {
            const groupDir = join(corpusRoot, genre, plotId);
            const metaPath = join(groupDir, "meta.json");
            if (!existsSync(metaPath)) {
                warnings.push(`跳过 ${genre}/${plotId}：缺 meta.json`);
                continue;
            }
            let meta: RawGroupMeta;
            try {
                meta = JSON.parse(readFileSync(metaPath, "utf-8")) as RawGroupMeta;
            } catch (error) {
                warnings.push(`跳过 ${genre}/${plotId}：meta.json 非法 JSON（${error instanceof Error ? error.message : String(error)}）`);
                continue;
            }
            for (const raw of meta.samples ?? []) {
                const sample = toSample(raw, genre, plotId, groupDir, warnings);
                if (sample) {
                    samples.push(sample);
                }
            }
        }
    }
    return {samples, warnings};
}

/**
 * 报告可比性守门：每个 render 必须携带同一个样本级 promptVersion。
 * 缺失或混用都直接抛错，禁止把不可比样本降级为普通 warning（I8）。
 */
export function assertRenderPromptVersion(samples: Sample[]): string | null {
    const renders = samples.filter((sample) => sample.role === "render");
    if (renders.length === 0) {
        return null;
    }
    const missing = renders.filter((sample) => typeof sample.promptVersion !== "string" || sample.promptVersion.trim().length === 0);
    if (missing.length > 0) {
        const examples = missing.slice(0, 5).map((sample) => `${sample.genre}/${sample.plotId}/${sample.file}`).join(", ");
        const remaining = missing.length > 5 ? `；另有 ${missing.length - 5} 个` : "";
        throw new Error(`render 样本缺 promptVersion，拒绝生成报告（I8，共 ${missing.length} 个）：${examples}${remaining}`);
    }
    const versions = new Set(renders.map((sample) => sample.promptVersion!.trim()));
    if (versions.size > 1) {
        throw new Error(`render prompt 版本混用，拒绝生成报告（I8）：${[...versions].sort().join(", ")}`);
    }
    return versions.values().next().value ?? null;
}

function toSample(raw: RawSampleMeta, genre: string, plotId: string, groupDir: string, warnings: string[]): Sample | null {
    if (!raw.file) {
        warnings.push(`${genre}/${plotId}：样本缺 file 字段，跳过`);
        return null;
    }
    const role = (VALID_ROLES as string[]).includes(raw.role ?? "") ? (raw.role as SampleRole) : null;
    if (!role) {
        warnings.push(`${genre}/${plotId}/${raw.file}：role 非法（${raw.role}），跳过`);
        return null;
    }
    const absPath = join(groupDir, raw.file);
    if (!existsSync(absPath)) {
        warnings.push(`${genre}/${plotId}/${raw.file}：文件不存在，跳过`);
        return null;
    }
    const text = readFileSync(absPath, "utf-8");
    return {
        role,
        genre,
        plotId,
        model: raw.model,
        modelVersion: raw.modelVersion,
        styleKey: raw.styleKey,
        difficulty: raw.difficulty,
        promptVersion: raw.promptVersion,
        split: raw.split === "train" || raw.split === "test" ? raw.split : undefined,
        referenceSource: raw.referenceSource,
        pairRef: raw.pairRef,
        file: raw.file,
        absPath,
        text,
        charCount: visibleLength(text),
    };
}

function listDirs(root: string): string[] {
    return readdirSync(root, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

/** 可见字数：去空白后的码点数，与 acquisition 口径一致。 */
export function visibleLength(text: string): number {
    return [...text.replace(/\s/gu, "")].length;
}

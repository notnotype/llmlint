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
    split?: string;
    referenceSource?: string;
    pairRef?: string;
};

type RawGroupMeta = {genre?: string; plotId?: string; promptVersion?: {brief?: string; render?: string}; samples?: RawSampleMeta[]};

export type LoadCorpusResult = {samples: Sample[]; warnings: string[]};

const VALID_ROLES: SampleRole[] = ["reference", "render", "repair"];

/** 加载整个语料目录为扁平 Sample[]。 */
export function loadCorpus(corpusRoot: string): LoadCorpusResult {
    if (!existsSync(corpusRoot) || !statSync(corpusRoot).isDirectory()) {
        throw new Error(`语料目录不存在或不是目录：${corpusRoot}`);
    }
    const samples: Sample[] = [];
    const warnings: string[] = [];
    // 收集各题组的 render prompt 版本：混版本 = lift 数字不可比（I8），必须显式告警。
    const renderPromptVersions = new Set<string>();

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
            if (meta.promptVersion?.render && (meta.samples ?? []).some((s) => s.role === "render")) {
                renderPromptVersions.add(meta.promptVersion.render);
            }
            for (const raw of meta.samples ?? []) {
                const sample = toSample(raw, genre, plotId, groupDir, warnings);
                if (sample) {
                    samples.push(sample);
                }
            }
        }
    }
    // I8：跨题组 render prompt 版本不一致 → lift 混了不同 prompt 生成的 AI 样本，警告。
    if (renderPromptVersions.size > 1) {
        warnings.push(`⚠ render prompt 版本混用：${[...renderPromptVersions].join(", ")}——跨版本 lift 不可直接比（I8）。`);
    }
    return {samples, warnings};
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

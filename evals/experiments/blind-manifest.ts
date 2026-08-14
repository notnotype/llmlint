import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";

type Arm = "control" | "current-default" | "beileng-clean" | "distilled";
type RawSample = {file?: string; role?: string; styleKey?: string; model?: string; pairRef?: string; charCount?: number};
type RawMeta = {samples?: RawSample[]};
type Mapping = {blindId: string; sourceFile: string; pairRef: string; arm: Arm; model: string};
type Manifest = {version: string; createdAt: string; pool: "private"; items: Array<{blindId: string; body: string; charCount: number}>};
type Options = {corpus: string; output: string; seed: string};

const ARMS: readonly Arm[] = ["control", "current-default", "beileng-clean", "distilled"];

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableHash(value: string): number {
    return Number.parseInt(sha256(value).slice(0, 8), 16);
}

function shuffle<T>(values: T[], seed: string): T[] {
    return [...values].sort((left, right) => stableHash(`${seed}:${JSON.stringify(left)}`) - stableHash(`${seed}:${JSON.stringify(right)}`));
}

function listDirs(root: string): string[] {
    return readdirSync(root, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

function isArm(value: string | undefined): value is Arm {
    return typeof value === "string" && ARMS.includes(value as Arm);
}

/** 为每个完整四臂配对生成匿名正文，并另存私密解码映射。 */
function collect(root: string, seed: string): {items: Manifest["items"]; mapping: Mapping[]} {
    const items: Manifest["items"] = [];
    const mapping: Mapping[] = [];
    for (const genre of listDirs(root)) {
        for (const plot of listDirs(join(root, genre))) {
            const groupRoot = join(root, genre, plot);
            const metaPath = join(groupRoot, "meta.json");
            if (!existsSync(metaPath)) continue;
            const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RawMeta;
            const pairs = new Map<string, RawSample[]>();
            for (const sample of meta.samples ?? []) {
                if (sample.role !== "render" || !sample.file || !sample.pairRef || !isArm(sample.styleKey)) continue;
                const pair = pairs.get(sample.pairRef) ?? [];
                pair.push(sample);
                pairs.set(sample.pairRef, pair);
            }
            for (const [pairRef, samples] of pairs) {
                const arms = new Set(samples.map((sample) => sample.styleKey));
                if (arms.size !== ARMS.length || ARMS.some((arm) => !arms.has(arm))) continue;
                for (const [index, sample] of shuffle(samples, seed).entries()) {
                    const body = readFileSync(join(groupRoot, sample.file!), "utf8");
                    const blindId = `${genre}-${plot}-${pairRef.replace(/\W/gu, "")}-${index + 1}`;
                    items.push({blindId, body, charCount: sample.charCount ?? [...body.replace(/\s/gu, "")].length});
                    mapping.push({blindId, sourceFile: `${genre}/${plot}/${sample.file}`, pairRef: `${genre}/${plot}/${pairRef}`, arm: sample.styleKey as Arm, model: sample.model ?? ""});
                }
            }
        }
    }
    return {items, mapping};
}

function run(opts: Options): void {
    const {items, mapping} = collect(resolve(opts.corpus), opts.seed);
    if (items.length === 0) throw new Error(`没有找到完整四臂配对：${opts.corpus}`);
    const outputRoot = resolve(opts.output);
    mkdirSync(outputRoot, {recursive: true});
    const manifest: Manifest = {version: "style-blind-v1", createdAt: new Date().toISOString(), pool: "private", items};
    writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileSync(join(outputRoot, "mapping.json"), `${JSON.stringify({version: "style-blind-v1", seed: opts.seed, mapping}, null, 2)}\n`, "utf8");
    console.log(`生成匿名盲评 manifest：${items.length} 篇；公开 manifest 未写入 arm/model/source。`);
}

const program = new Command();
program.name("blind-manifest").description("生成匿名私有盲评 manifest").option("--corpus <dir>", "四臂实验语料根").option("--output <dir>", "匿名 manifest 输出目录").option("--seed <value>", "稳定随机种子", "style-blind-v1").action((opts: Options) => run(opts));
await program.parseAsync(process.argv);

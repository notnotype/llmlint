// reference 数据集的 catalog 状态层。
// 书目身份（title/author/genre/评分/sha256）以 manifest.tsv 为真相源，本模块不复制；
// catalog.json 只记 curation 状态（转换/切章/选章/入语料），按 dataset_relative_path 引用 manifest 行。
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

/** manifest.tsv 一行（字段名与表头一致）。 */
export type ManifestRow = {
    rank: string;
    title: string;
    author: string;
    genre: string;
    popularity_score: string;
    writing_story_score: string;
    reason: string;
    source_relative_path: string;
    dataset_relative_path: string;
    extension: string;
    bytes: string;
    sha256: string;
};

/** catalog.json 一条 curation 状态。ref = manifest 的 dataset_relative_path。 */
export type CatalogEntry = {
    ref: string;
    /** raw=未处理；converted=已转 epub；curated=已选章入语料 */
    status: "raw" | "converted" | "curated";
    /** 转换产物路径（相对 datasetsRoot）；仅 mobi 等需转换的格式非空 */
    convertedPath?: string;
    /** 语料题材 key（题材映射表产出，作 corpus 目录名与分层 key） */
    genreKey?: string;
    /** 入语料的题组 id */
    plotId?: string;
    /** 选章方式：acquire 的 skip/maxChapters 消费口径 */
    selectedChapters?: {skip: number; maxChapters: number};
    /** 出版/首发年份（人工补，pre-2023 纪律见 CONTEXT I6） */
    pubYear?: number;
    notes?: string;
};

export type Catalog = {entries: CatalogEntry[]};

// manifest 中文题材 → 语料题材 key（corpus 目录名 + byGenre 分层）。
// 只映射实际策展过的题材；新题材入语料前先在这里补一行（enumOrString：不强求命中 task06 枚举）。
export const GENRE_KEY_MAP: Record<string, string> = {
    "经典武侠": "wuxia",
    "武侠": "wuxia",
    "历史武侠": "wuxia",
    "玄幻/武侠": "wuxia",
    "宫斗": "gongdou",
    "历史架空": "lishi",
    "历史": "lishi",
    "历史穿越": "lishi",
    "无限流": "wuxianliu",
    "游戏/悬疑": "xuanyi",
    "东方玄幻": "xuanhuan",
    "异世玄幻": "xuanhuan",
    "都市言情": "dushi",
    "都市": "dushi",
};

/** 读 manifest.tsv（真相源，只读不写）。 */
export function loadManifest(datasetsRoot: string): ManifestRow[] {
    const raw = readFileSync(join(datasetsRoot, "manifest.tsv"), "utf-8");
    const lines = raw.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    const header = (lines[0] ?? "").split("\t");
    return lines.slice(1).map((line) => {
        const cells = line.split("\t");
        const row = {} as Record<string, string>;
        header.forEach((key, i) => {
            row[key] = cells[i] ?? "";
        });
        return row as ManifestRow;
    });
}

/** 读 catalog.json（没有则空 catalog）。 */
export function loadCatalog(datasetsRoot: string): Catalog {
    const path = join(datasetsRoot, "catalog.json");
    if (!existsSync(path)) {
        return {entries: []};
    }
    return JSON.parse(readFileSync(path, "utf-8")) as Catalog;
}

/** 写回 catalog.json。 */
export function saveCatalog(datasetsRoot: string, catalog: Catalog): void {
    writeFileSync(join(datasetsRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf-8");
}

/** 更新（或插入）一条 catalog 状态，按 ref 定位。 */
export function upsertEntry(catalog: Catalog, next: CatalogEntry): Catalog {
    const rest = catalog.entries.filter((entry) => entry.ref !== next.ref);
    return {entries: [...rest, next].sort((a, b) => a.ref.localeCompare(b.ref))};
}

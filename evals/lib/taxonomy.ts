// 文本分类的预定义值集（题材/体裁/视角）——单一真相源。
// 消费方：LLM 分类器（classifier/）、render 的题材标签（generator/render.ts）、web 端（经 nuxt alias `evals` 引用）。
// 纪律：值集只增不改 key；LLM 分类必须命中白名单，拿不准选 "unknown"（宁缺勿错——错值会污染 byGenre 分层与 task profile 切片）。

export type TaxonomyEntry = {key: string; label: string};

/** 题材（genre）。key = corpus 目录名 / 分层 key；与 acquire/catalog.ts 的 GENRE_KEY_MAP 值域一致。 */
export const GENRES: TaxonomyEntry[] = [
    {key: "xuanhuan", label: "玄幻"},
    {key: "xianxia", label: "仙侠修真"},
    {key: "wuxia", label: "武侠"},
    {key: "dushi", label: "都市"},
    {key: "guyan", label: "古代言情"},
    {key: "xianyan", label: "现代言情"},
    {key: "gongdou", label: "宫斗"},
    {key: "kehuan", label: "科幻"},
    {key: "xuanyi", label: "悬疑"},
    {key: "lishi", label: "历史"},
    {key: "wuxianliu", label: "无限流"},
    {key: "light-novel", label: "轻小说"},
    {key: "literary", label: "严肃文学"},
];

/** 体裁（textType）。 */
export const TEXT_TYPES: TaxonomyEntry[] = [
    {key: "novel", label: "小说"},
    {key: "prose", label: "散文"},
    {key: "script", label: "剧本"},
    {key: "other", label: "其他"},
];

/** 叙述视角（pov）。 */
export const POVS: TaxonomyEntry[] = [
    {key: "first", label: "第一人称"},
    {key: "third", label: "第三人称"},
    {key: "omniscient", label: "全知视角"},
    {key: "second", label: "第二人称"},
];

/** key → 中文标签（未知 key 原样返回，enumOrString 兼容）。 */
export function taxonomyLabel(entries: TaxonomyEntry[], key: string): string {
    return entries.find((entry) => entry.key === key)?.label ?? key;
}

/** key 是否在值集内。 */
export function inTaxonomy(entries: TaxonomyEntry[], key: string): boolean {
    return entries.some((entry) => entry.key === key);
}

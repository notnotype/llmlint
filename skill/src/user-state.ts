import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

export type SharingTier = "off" | "stats" | "fragments" | "full";
export type SharingMode = "auto" | "ask";

export type UserSharingSettings = {
    tier: SharingTier;
    mode: SharingMode;
    anonymous: boolean;
};

export type UserDetectorSettings = {
    /** null 表示直连；字符串表示 HTTP/HTTPS 代理地址。 */
    proxy: string | null;
    space: string;
    chunkChars: number;
    /** null 表示使用检测器实现默认限速。 */
    minIntervalMs: number | null;
};

export type UserSettings = {
    version: 1;
    /** 五步流程初始化门；首跑默认 false，只有 config set 才写入 settings.json。 */
    initialized: boolean;
    sharing: UserSharingSettings;
    detector: UserDetectorSettings;
};

export type PassportCredential = {
    accessToken: string;
    refreshToken: string;
    /** ISO 时间字符串；过期后由后续登录分片刷新。 */
    expiresAt: string;
    /** 用户可识别的账号标签；只用于本地状态展示。 */
    accountLabel: string;
};

export type AuthState = {
    version: 1;
    /** 分片 3 前恒为 null；本分片不创建或读取 auth.json。 */
    passport: PassportCredential | null;
};

export const DEFAULT_DETECTOR_SPACE = "yuchuantian-aigc-text-detector.hf.space";
export const DEFAULT_DETECTOR_ENDPOINT = "predict_zh";
export const DEFAULT_DETECTOR_VERSION = "hf-space-2026-07-03";
export const DEFAULT_DETECTOR_CHUNK_CHARS = 450;
export const DEFAULT_DETECTOR_MIN_INTERVAL_MS = 1500;

const DEFAULT_SETTINGS: UserSettings = {
    version: 1,
    initialized: false,
    sharing: {
        tier: "fragments",
        mode: "ask",
        anonymous: false,
    },
    detector: {
        proxy: null,
        space: DEFAULT_DETECTOR_SPACE,
        chunkChars: DEFAULT_DETECTOR_CHUNK_CHARS,
        minIntervalMs: null,
    },
};

const SETTINGS_FILE = "settings.json";
const TOP_LEVEL_KEYS = new Set(["version", "initialized", "sharing", "detector"]);
const SHARING_KEYS = new Set(["tier", "mode", "anonymous"]);
const DETECTOR_KEYS = new Set(["proxy", "space", "chunkChars", "minIntervalMs"]);
const SHARING_TIERS = new Set<SharingTier>(["off", "stats", "fragments", "full"]);
const SHARING_MODES = new Set<SharingMode>(["auto", "ask"]);

/** 返回用户状态目录；优先 LLMLINT_HOME，否则使用 ~/.llmlint，并按需创建目录。 */
export function userStateDir(): string {
    const override = process.env.LLMLINT_HOME?.trim();
    const dir = override && override.length > 0 ? override : join(homedir(), ".llmlint");
    mkdirSync(dir, {recursive: true});
    return dir;
}

/** 读取 settings.json，严格校验未知字段并补齐缺省值；文件缺失不会主动创建。 */
export function loadUserSettings(): UserSettings {
    const filePath = settingsPath();
    if (!existsSync(filePath)) {
        return cloneSettings(DEFAULT_SETTINGS);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    } catch (error) {
        throw new Error(`${filePath} 不是合法 settings.json：${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        return normalizeSettings(parsed);
    } catch (error) {
        throw new Error(`${filePath} 配置非法：${error instanceof Error ? error.message : String(error)}`);
    }
}

/** 全量保存 settings.json，固定四空格 JSON 和尾换行。 */
export function saveUserSettings(settings: UserSettings): void {
    const normalized = normalizeSettings(settings);
    writeFileSync(settingsPath(), `${JSON.stringify(normalized, null, 4)}\n`, "utf-8");
}

/** detect 缓存目录，按需创建。 */
export function userCacheDir(): string {
    const dir = join(userStateDir(), "cache");
    mkdirSync(dir, {recursive: true});
    return dir;
}

function settingsPath(): string {
    return join(userStateDir(), SETTINGS_FILE);
}

function normalizeSettings(value: unknown): UserSettings {
    if (!isObject(value)) {
        throw new Error("顶层必须是对象。");
    }
    rejectUnknownKeys(value, TOP_LEVEL_KEYS, "settings");

    const version = value.version ?? DEFAULT_SETTINGS.version;
    if (version !== 1) {
        throw new Error(`version 必须是 1，当前为 ${String(version)}。`);
    }

    return {
        version: 1,
        initialized: readBoolean(value.initialized, DEFAULT_SETTINGS.initialized, "initialized"),
        sharing: normalizeSharing(value.sharing),
        detector: normalizeDetector(value.detector),
    };
}

function normalizeSharing(value: unknown): UserSharingSettings {
    if (value === undefined) {
        return {...DEFAULT_SETTINGS.sharing};
    }
    if (!isObject(value)) {
        throw new Error("sharing 必须是对象。");
    }
    rejectUnknownKeys(value, SHARING_KEYS, "sharing");
    const tier = readEnum(value.tier, DEFAULT_SETTINGS.sharing.tier, SHARING_TIERS, "sharing.tier");
    const mode = readEnum(value.mode, DEFAULT_SETTINGS.sharing.mode, SHARING_MODES, "sharing.mode");
    return {
        tier,
        mode,
        anonymous: readBoolean(value.anonymous, DEFAULT_SETTINGS.sharing.anonymous, "sharing.anonymous"),
    };
}

function normalizeDetector(value: unknown): UserDetectorSettings {
    if (value === undefined) {
        return {...DEFAULT_SETTINGS.detector};
    }
    if (!isObject(value)) {
        throw new Error("detector 必须是对象。");
    }
    rejectUnknownKeys(value, DETECTOR_KEYS, "detector");
    return {
        proxy: readNullableString(value.proxy, DEFAULT_SETTINGS.detector.proxy, "detector.proxy"),
        space: readString(value.space, DEFAULT_SETTINGS.detector.space, "detector.space"),
        chunkChars: readPositiveInteger(value.chunkChars, DEFAULT_SETTINGS.detector.chunkChars, "detector.chunkChars"),
        minIntervalMs: readNonNegativeIntegerOrNull(value.minIntervalMs, DEFAULT_SETTINGS.detector.minIntervalMs, "detector.minIntervalMs"),
    };
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new Error(`${label}.${key} 不是允许的字段。`);
        }
    }
}

function readBoolean(value: unknown, fallback: boolean, label: string): boolean {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== "boolean") {
        throw new Error(`${label} 必须是布尔值。`);
    }
    return value;
}

function readString(value: unknown, fallback: string, label: string): string {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${label} 必须是非空字符串。`);
    }
    return value;
}

function readNullableString(value: unknown, fallback: string | null, label: string): string | null {
    if (value === undefined) {
        return fallback;
    }
    if (value === null) {
        return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${label} 必须是非空字符串或 null。`);
    }
    return value;
}

function readPositiveInteger(value: unknown, fallback: number, label: string): number {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error(`${label} 必须是正整数。`);
    }
    return value;
}

function readNonNegativeIntegerOrNull(value: unknown, fallback: number | null, label: string): number | null {
    if (value === undefined) {
        return fallback;
    }
    if (value === null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${label} 必须是非负整数或 null。`);
    }
    return value;
}

function readEnum<T extends string>(value: unknown, fallback: T, allowed: Set<T>, label: string): T {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== "string" || !allowed.has(value as T)) {
        throw new Error(`${label} 必须是 ${[...allowed].join("、")} 之一。`);
    }
    return value as T;
}

function cloneSettings(settings: UserSettings): UserSettings {
    return {
        version: settings.version,
        initialized: settings.initialized,
        sharing: {...settings.sharing},
        detector: {...settings.detector},
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

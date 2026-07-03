// token 预算：render 前预估、render 后实报 + 自校准。
// 预估口径：中文 ≈ chars/charsPerToken（初值 1.5）；一次 render 的 token ≈ (brief 字 + 目标字)/系数（输入）+ 目标字/系数（输出）。
// 自校准：真跑累计 estimate/actual，把比率存回，下轮估算乘以修正系数（拍脑袋系数逐轮变准）。
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const CALIBRATION_PATH = join(import.meta.dir, "..", "report", "budget-calibration.json");
const DEFAULT_CHARS_PER_TOKEN = 1.5;

export type Calibration = {charsPerToken: number; ratioSamples: number; lastRatio: number};

/** 读校准系数（没有则默认）。 */
export function loadCalibration(): Calibration {
    if (existsSync(CALIBRATION_PATH)) {
        try {
            return JSON.parse(readFileSync(CALIBRATION_PATH, "utf-8")) as Calibration;
        } catch {
            // 损坏则回默认，不阻断
        }
    }
    return {charsPerToken: DEFAULT_CHARS_PER_TOKEN, ratioSamples: 0, lastRatio: 1};
}

/** 估一次 render 的 token（in + out）。 */
export function estimateRenderTokens(briefChars: number, targetChars: number, charsPerToken = DEFAULT_CHARS_PER_TOKEN): {input: number; output: number} {
    // 输入 ≈ system(固定小) + brief；system 折 200 token 常量。输出 ≈ 目标字数。
    return {
        input: Math.round(briefChars / charsPerToken) + 200,
        output: Math.round(targetChars / charsPerToken),
    };
}

/** 累加器：分模型汇总预估/实报。 */
export class BudgetTracker {
    private readonly est = new Map<string, {input: number; output: number; count: number}>();
    private readonly act = new Map<string, {input: number; output: number; count: number; estimated: number}>();

    addEstimate(modelKey: string, input: number, output: number): void {
        const cur = this.est.get(modelKey) ?? {input: 0, output: 0, count: 0};
        this.est.set(modelKey, {input: cur.input + input, output: cur.output + output, count: cur.count + 1});
    }

    /** 记一次真实用量；usage 缺失（CLI text 通道）时 estimated=1，标"估算"。 */
    addActual(modelKey: string, usage: {input?: number; output?: number} | undefined, fallback: {input: number; output: number}): void {
        const cur = this.act.get(modelKey) ?? {input: 0, output: 0, count: 0, estimated: 0};
        const hasUsage = usage?.output !== undefined;
        this.act.set(modelKey, {
            input: cur.input + (usage?.input ?? fallback.input),
            output: cur.output + (usage?.output ?? fallback.output),
            count: cur.count + 1,
            estimated: cur.estimated + (hasUsage ? 0 : 1),
        });
    }

    /** 预估汇总表（估算阶段打印）。 */
    estimateReport(): {rows: Array<{modelKey: string; input: number; output: number; total: number; count: number}>; total: number} {
        const rows = [...this.est.entries()].map(([modelKey, v]) => ({modelKey, input: v.input, output: v.output, total: v.input + v.output, count: v.count}));
        return {rows, total: rows.reduce((sum, r) => sum + r.total, 0)};
    }

    /** 实报汇总表（真跑后打印）。 */
    actualReport(): {rows: Array<{modelKey: string; input: number; output: number; total: number; count: number; estimated: number}>; total: number} {
        const rows = [...this.act.entries()].map(([modelKey, v]) => ({modelKey, input: v.input, output: v.output, total: v.input + v.output, count: v.count, estimated: v.estimated}));
        return {rows, total: rows.reduce((sum, r) => sum + r.total, 0)};
    }
}

/** 真跑后自校准：用实报 output 与预估 output 的比率修正 charsPerToken，写回。 */
export function calibrate(estOutput: number, actOutput: number, prev: Calibration): Calibration {
    if (actOutput <= 0 || estOutput <= 0) {
        return prev;
    }
    // 实报 > 预估 → 系数偏大（每 token 装的字太多），调小；反之调大。指数滑动平均，防单轮抖动。
    const ratio = estOutput / actOutput;
    const nextCharsPerToken = prev.charsPerToken * (0.7 + 0.3 * ratio);
    const next = {charsPerToken: Number(nextCharsPerToken.toFixed(3)), ratioSamples: prev.ratioSamples + 1, lastRatio: Number(ratio.toFixed(3))};
    try {
        writeFileSync(CALIBRATION_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    } catch {
        // report 目录可能还没建，忽略；下轮 score 会建
    }
    return next;
}

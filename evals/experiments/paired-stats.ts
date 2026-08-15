/** 配对统计共享工具：机器诊断与人评报告使用同一数学口径。 */

/** 计算数值中位数；空输入返回 null。 */
export function median(values: readonly number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

/** 计算组合数 C(n,k)，供精确符号检验使用。 */
function binomial(n: number, k: number): number {
    let value = 1;
    for (let index = 0; index < k; index += 1) {
        value = (value * (n - index)) / (index + 1);
    }
    return value;
}

/**
 * 计算忽略 ties 后的双侧精确二项符号检验 p 值。
 * decided=0 表示没有方向性观察，返回 null。
 */
export function signTestP(wins: number, decided: number): number | null {
    if (decided === 0) {
        return null;
    }
    const extreme = Math.max(wins, decided - wins);
    let tail = 0;
    for (let value = extreme; value <= decided; value += 1) {
        tail += binomial(decided, value);
    }
    return Math.min(1, (2 * tail) / 2 ** decided);
}

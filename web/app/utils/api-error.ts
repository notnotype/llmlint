/**
 * 从 $fetch 异常中解析用户可读错误文案。
 */
export function resolveApiErrorMessage(error: unknown, fallback: string): string {
    // $fetch 错误结构来自外部库，运行时形态不受本项目类型系统控制，因此这里用 unknown 逐层收窄。
    if (typeof error !== "object" || error === null) {
        return fallback;
    }
    const data = "data" in error ? (error as {data?: unknown}).data : null;
    if (typeof data === "object" && data !== null && "message" in data && typeof (data as {message?: unknown}).message === "string") {
        return (data as {message: string}).message;
    }
    if ("message" in error && typeof (error as {message?: unknown}).message === "string") {
        return (error as {message: string}).message;
    }
    return fallback;
}

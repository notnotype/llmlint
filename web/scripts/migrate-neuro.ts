import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve} from "node:path";
import {agentHarness} from "../server/agent";
import {AgentSessionRebuilder} from "../server/agent/session-rebuild";
import {prisma} from "../server/database/prisma";
import {readEvalConfig, resolveChannelModel} from "../server/utils/eval-channel";

const EXPECTED_PACKAGE_VERSION = "0.1.0";
const repoRoot = resolve(import.meta.dir, "../..");

/** 一次性执行历史 Session 重建，并在全部成功后应用 schema hard cut。 */
async function main(): Promise<void> {
    if (await hardCutApplied()) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "_agent_session_rebuild"`);
        console.log("Agent Harness hard cut 已完成，无需重复重建。");
        return;
    }
    await preflightPackage();
    await preflightModel();
    await preflightDatabase();
    await ensureTerminationColumn();
    const backupPath = await backupDatabase();
    const rebuilder = new AgentSessionRebuilder({client: prisma, harness: agentHarness});
    await rebuilder.prepare();
    const report = await rebuilder.run();
    const reportPath = await writeReport(report);
    if (report.failed > 0) {
        throw new Error(`Agent Session 重建有 ${report.failed}/${report.total} 个 revision 失败；ledger 已保留。报告：${reportPath}`);
    }

    await deployHardCut();
    await rebuilder.cleanup();
    console.log(`Agent Session 重建完成：${report.completed}/${report.total}`);
    console.log(`数据库备份：${backupPath}`);
    console.log(`迁移报告：${reportPath}`);
}

/** 校验依赖已经切到公开精确版本，避免重建依赖 sibling 源码。 */
async function preflightPackage(): Promise<void> {
    const rootPackage = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {dependencies?: {[name: string]: string}};
    const declared = rootPackage.dependencies?.["@notnotype/neuro-agent-harness"];
    if (declared !== EXPECTED_PACKAGE_VERSION) {
        throw new Error(`必须先安装公开精确版本 @notnotype/neuro-agent-harness@${EXPECTED_PACKAGE_VERSION}，当前声明为 ${declared ?? "缺失"}`);
    }
    const installed = JSON.parse(await readFile(join(repoRoot, "node_modules", "@notnotype", "neuro-agent-harness", "package.json"), "utf8")) as {version?: string};
    if (installed.version !== EXPECTED_PACKAGE_VERSION) throw new Error(`已安装 Harness 版本为 ${installed.version ?? "未知"}`);
}

/** 校验真实 repair model 和 models config 可以解析。 */
async function preflightModel(): Promise<void> {
    const loaded = readEvalConfig();
    if (!loaded.ok) throw new Error(`LLM 配置读取失败：${loaded.error}`);
    const modelKey = loaded.config.repair?.model;
    if (!modelKey) throw new Error("eval.config.json 缺少 repair.model");
    resolveChannelModel(loaded.config, loaded.configPath, modelKey);
}

/** 校验目标数据库可读写且仍处于 hard cut 前的预期 schema。 */
async function preflightDatabase(): Promise<void> {
    await prisma.$queryRawUnsafe(`SELECT 1`);
    const required = ["Revision", "AgentSession", "AgentSessionEntry", "AgentInvocation", "MachineLlmReview"];
    const rows = await prisma.$queryRawUnsafe<Array<{name: string}>>(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table'`);
    const tables = new Set(rows.map(row => row.name));
    for (const table of required) if (!tables.has(table)) throw new Error(`数据库缺少表 ${table}`);
}

/** 迁移期间临时增加新 Core 所需字段；最终 migration 会重建并正式接管该字段。 */
async function ensureTerminationColumn(): Promise<void> {
    const columns = await prisma.$queryRawUnsafe<Array<{name: string}>>(`PRAGMA table_info("AgentInvocation")`);
    if (!columns.some(column => column.name === "terminationReason")) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "AgentInvocation" ADD COLUMN "terminationReason" TEXT`);
    }
}

/** 使用 SQLite VACUUM INTO 生成一致性备份。 */
async function backupDatabase(): Promise<string> {
    const directory = join(repoRoot, ".agent", "backups");
    await mkdir(directory, {recursive: true});
    const path = join(directory, `llmlint-agent-${fileTimestamp(new Date())}.db`);
    const escaped = path.replaceAll("'", "''").replaceAll("\\", "/");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
    return path;
}

/** 导出用户可审计的 JSON 迁移报告。 */
async function writeReport(report: Awaited<ReturnType<AgentSessionRebuilder["run"]>>): Promise<string> {
    const path = join(repoRoot, ".agent", `agent-session-rebuild-${fileTimestamp(new Date())}.json`);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify(report, null, 4)}\n`);
    return path;
}

/** 应用唯一待执行的 harness hard-cut migration。 */
async function deployHardCut(): Promise<void> {
    const child = Bun.spawn({
        cmd: [process.execPath, "x", "prisma", "migrate", "deploy"],
        cwd: join(repoRoot, "web"),
        env: {...process.env, DATABASE_URL: migrationDatabaseUrl()},
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`prisma migrate deploy 失败，exitCode=${exitCode}`);
}

/** Prisma Windows schema engine 对绝对 file: URL 会报空错误，migrate 子进程统一改用等价相对路径。 */
function migrationDatabaseUrl(): string {
    const configured = process.env.DATABASE_URL?.trim() || "file:./data.db";
    if (!configured.startsWith("file:")) throw new Error(`只支持 file: SQLite URL，当前为 ${configured}`);
    const path = configured.slice("file:".length);
    if (!isAbsolute(path)) return configured;
    const relativePath = relative(join(repoRoot, "web"), path).replaceAll("\\", "/");
    return `file:${relativePath.startsWith(".") ? relativePath : `./${relativePath}`}`;
}

/** harnessKind 列消失即表示一次性 hard cut 已完成。 */
async function hardCutApplied(): Promise<boolean> {
    const columns = await prisma.$queryRawUnsafe<Array<{name: string}>>(`PRAGMA table_info("AgentSession")`);
    return columns.length > 0 && !columns.some(column => column.name === "harnessKind");
}

function fileTimestamp(date: Date): string {
    return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

try {
    await main();
} finally {
    await prisma.$disconnect();
}

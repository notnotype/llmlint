import {createClient} from "@libsql/client";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";

const databaseUrl = process.env.DATABASE_URL?.trim() || "file:./data.db";
const migrationsDir = resolve(import.meta.dir, "../prisma/migrations");

if (!databaseUrl.startsWith("file:")) {
    throw new Error(`db:init 只支持本地 file: SQLite URL，当前为：${databaseUrl}`);
}

const client = createClient({url: databaseUrl});

/**
 * 执行一条 SQL。SQLite migration 文件中没有触发器，按分号切分足够覆盖当前用法。
 */
async function executeSql(sql: string): Promise<void> {
    for (const statement of sql.split(";").map((item) => item.trim()).filter(Boolean)) {
        await client.execute(statement);
    }
}

/**
 * 初始化本地数据库，作为 Prisma schema engine 在本机不可用时的确定性入口。
 */
async function main(): Promise<void> {
    await client.execute(`
        CREATE TABLE IF NOT EXISTS "_llmlint_migrations" (
            "name" TEXT NOT NULL PRIMARY KEY,
            "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const applied = new Set<string>();
    const appliedRows = await client.execute(`SELECT "name" FROM "_llmlint_migrations"`);
    for (const row of appliedRows.rows) {
        if (typeof row.name === "string") {
            applied.add(row.name);
        }
    }

    const migrationNames = readdirSync(migrationsDir)
        .filter((name) => /^\d+_/.test(name) && existsSync(join(migrationsDir, name, "migration.sql")))
        .sort();

    for (const name of migrationNames) {
        if (applied.has(name)) {
            continue;
        }
        const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf-8");
        await executeSql(sql);
        await client.execute({
            sql: `INSERT INTO "_llmlint_migrations" ("name") VALUES (?)`,
            args: [name],
        });
        console.log(`已应用 migration：${name}`);
    }

    console.log(`数据库已就绪：${databaseUrl}`);
}

try {
    await main();
} finally {
    client.close();
}

import "dotenv/config";
import {defineConfig, env} from "prisma/config";

process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./data.db";

export default defineConfig({
    schema: "prisma/schema.prisma",
    datasource: {
        url: env("DATABASE_URL"),
    },
    migrations: {
        path: "prisma/migrations",
    },
});

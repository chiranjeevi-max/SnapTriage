/**
 * Drizzle Kit configuration for `db:migrate` and `db:studio`: SQLite by default,
 * Postgres when DATABASE_URL is set. Each dialect has its own schema and
 * migrations; `db:generate` names both, so it writes both whatever is set.
 */
import { defineConfig } from "drizzle-kit";

const isSqlite = !process.env.DATABASE_URL;

export default defineConfig(
  isSqlite
    ? {
        dialect: "sqlite",
        schema: "./src/lib/db/schema.ts",
        out: "./drizzle",
        dbCredentials: {
          url: process.env.SQLITE_PATH ?? "./data/snaptriage.db",
        },
      }
    : {
        dialect: "postgresql",
        schema: "./src/lib/db/schema.pg.ts",
        out: "./drizzle-pg",
        dbCredentials: {
          url: process.env.DATABASE_URL!,
        },
      }
);

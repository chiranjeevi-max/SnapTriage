/** Drizzle Kit configuration -- selects SQLite (default) or PostgreSQL based on DATABASE_URL. */
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
        schema: "./src/lib/db/schema.ts",
        out: "./drizzle",
        dbCredentials: {
          url: process.env.DATABASE_URL!,
        },
      }
);

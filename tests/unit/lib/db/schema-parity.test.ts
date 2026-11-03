/**
 * @module tests/unit/lib/db/schema-parity.test.ts
 * `schema.pg.ts` must describe the same database as `schema.ts`, with each
 * column stored as the Postgres type that holds what its SQLite column writes.
 */
import { describe, it, expect } from "vitest";
import { getTableName, is, type Column } from "drizzle-orm";
import { getTableConfig as getPgConfig, PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getSqliteConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as sqliteSchema from "@/lib/db/schema";
import * as pgSchema from "@/lib/db/schema.pg";

/** The Postgres column type that stores each SQLite column type. */
const PG_TYPE_OF: Record<string, string> = {
  SQLiteText: "PgText",
  SQLiteTextJson: "PgText",
  SQLiteInteger: "PgInteger",
  SQLiteTimestamp: "PgBigInt53",
  SQLiteBoolean: "PgBoolean",
};

type TableConfig = ReturnType<typeof getSqliteConfig> | ReturnType<typeof getPgConfig>;

function names(columns: readonly unknown[]) {
  return columns.map((column) => (column as Column).name);
}

/** A table as both schemas must agree on it, with column types in Postgres terms. */
function shape(config: TableConfig, pgType: (column: Column) => string) {
  return {
    columns: Object.fromEntries(
      config.columns.map((column: Column) => [
        column.name,
        {
          type: pgType(column),
          notNull: column.notNull,
          primary: column.primary,
          unique: column.isUnique ? column.uniqueName : null,
          // A JSON column's default is the value; Postgres holds its text.
          default:
            typeof column.default === "object" ? JSON.stringify(column.default) : column.default,
        },
      ])
    ),
    primaryKeys: config.primaryKeys.map((key) => names(key.columns)),
    foreignKeys: config.foreignKeys.map((key) => {
      const reference = key.reference();
      return {
        columns: names(reference.columns),
        table: getTableName(reference.foreignTable),
        foreignColumns: names(reference.foreignColumns),
        onDelete: key.onDelete,
      };
    }),
    indexes: config.indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
      columns: names(index.config.columns),
    })),
    uniqueConstraints: config.uniqueConstraints.map((constraint) => ({
      name: constraint.name,
      columns: names(constraint.columns),
    })),
  };
}

const sqliteTables = Object.values(sqliteSchema).filter((value) => is(value, SQLiteTable));
const pgTables = Object.values(pgSchema).filter((value) => is(value, PgTable));

describe("schema.pg", () => {
  it("describes the same tables, columns, keys and indexes as schema.ts", () => {
    const expected = Object.fromEntries(
      sqliteTables.map((table) => [
        getTableName(table),
        shape(getSqliteConfig(table), (column) => PG_TYPE_OF[column.columnType] ?? "unmapped"),
      ])
    );
    const actual = Object.fromEntries(
      pgTables.map((table) => [
        getTableName(table),
        shape(getPgConfig(table), (column) => column.columnType),
      ])
    );

    expect(actual).toEqual(expected);
  });
});

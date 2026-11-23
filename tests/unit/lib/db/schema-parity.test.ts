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

describe("follow_up_due_idx ordering", () => {
  /**
   * @target schema.pg.ts follow_up index config
   * @dependencies drizzle's index config
   * @scenario The Postgres copy of the check pass's index
   * @expectedOutput NULLS FIRST on the trailing columns. The pass orders
   *                 `attemptedAt NULLS FIRST` so a never-attempted row leads;
   *                 Postgres defaults to NULLS LAST and would sort the selected
   *                 rows itself, which is the cost this index exists to avoid.
   */
  it("declares NULLS FIRST where Postgres needs it", () => {
    const config = getPgConfig(pgSchema.followUps);
    const index = config.indexes.find((entry) => entry.config.name === "follow_up_due_idx");

    expect(index).toBeDefined();

    const placements = index!.config.columns.map((column) => {
      const extra = (column as unknown as { indexConfig?: { nulls?: string } }).indexConfig;
      return extra?.nulls ?? null;
    });

    // The filter prefix carries Postgres's default placement; the two ordered
    // columns are the ones the check pass sorts on, so those must be explicit.
    expect(placements).toEqual(["last", "last", "first", "first"]);
  });

  /**
   * @target schema.ts follow_up index
   * @dependencies drizzle's index config
   * @scenario The SQLite copy
   * @expectedOutput A plain index. SQLite already sorts NULL first, so declaring
   *                 the placement would describe an index the file does not have.
   */
  it("leaves the SQLite index plain", () => {
    const config = getSqliteConfig(sqliteSchema.followUps);
    const index = config.indexes.find((entry) => entry.config.name === "follow_up_due_idx");

    expect(index).toBeDefined();
    expect(index!.config.columns).toHaveLength(4);
  });
});

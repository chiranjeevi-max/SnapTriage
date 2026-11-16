/**
 * @module presets/preset-repository
 *
 * Data access for a user's triage presets, and the one place that turns the
 * stored `actions` JSON column back into a {@link PresetActions}.
 *
 * The column is JSON text, so it can hold anything that was written before a
 * schema change or edited outside the API. Both the list and the apply path
 * re-validate through `presetActionsSchema` here, which is what makes "a
 * corrupt row is skipped, never trusted" a single rule rather than two
 * implementations that could disagree.
 */
import { and, eq, count, sql } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { repos, triagePresets } from "@/lib/db/schema";
import { presetActionsSchema } from "@/lib/validations";
import type { Preset, PresetActions } from "@/features/presets/types";
import { apiLogger } from "@/lib/logger";

/** A stored preset row, with `actions` as the raw column text. */
export type PresetRow = Omit<typeof triagePresets.$inferSelect, "actions"> & {
  /**
   * Raw JSON text on a read, or the decoded object on an `insert`/`update`
   * `returning()`, which the driver decodes from the value it just wrote.
   * {@link toPreset} handles both.
   */
  actions: string | Record<string, unknown>;
};

/** The repository columns creation needs to confirm ownership. */
export type OwnedRepo = typeof repos.$inferSelect;

/**
 * Find a repository the user owns.
 *
 * Scoped by `userId` so a repo belonging to somebody else is reported as
 * missing: the caller learns that no such repo exists for them, not that it
 * exists for someone else.
 *
 * @param userId - The authenticated user.
 * @param repoId - The repository's primary key.
 * @returns The repo row, or `null` when the user does not own it.
 */
export async function findOwnedRepo(userId: string, repoId: string): Promise<OwnedRepo | null> {
  const rows = await typedDb
    .select()
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.userId, userId)));
  return rows[0] ?? null;
}

/**
 * Validate the stored JSON and reshape it as a {@link Preset}.
 *
 * The text is parsed here rather than by the driver so a malformed value is a
 * skipped row instead of a failed query: one bad preset must not hide the rest
 * of the user's presets.
 *
 * @param row - The stored row, with `actions` as raw JSON text.
 * @returns The preset, or `null` when the stored actions no longer parse or validate.
 */
export function toPreset(row: PresetRow): Preset | null {
  let decoded: unknown;
  try {
    decoded = typeof row.actions === "string" ? JSON.parse(row.actions) : row.actions;
  } catch {
    apiLogger.warn(
      { presetId: row.id, repoId: row.repoId },
      "Stored preset actions are not valid JSON and were skipped"
    );
    return null;
  }

  const parsed = presetActionsSchema.safeParse(decoded);
  if (!parsed.success) {
    apiLogger.warn(
      { presetId: row.id, repoId: row.repoId },
      "Stored preset actions failed validation and were skipped"
    );
    return null;
  }

  return {
    id: row.id,
    repoId: row.repoId,
    name: row.name,
    actions: parsed.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * List the current user's presets for one repository.
 *
 * Rows whose stored actions no longer validate are omitted rather than
 * returned half-parsed: one unreadable row must not break the whole picker.
 *
 * @param userId - The owning user.
 * @param repoId - The repository the presets belong to.
 * @returns The readable presets, ordered by name.
 */
export async function listPresets(userId: string, repoId: string): Promise<Preset[]> {
  const rows = await typedDb
    .select({
      id: triagePresets.id,
      userId: triagePresets.userId,
      repoId: triagePresets.repoId,
      name: triagePresets.name,
      // Read the column as text rather than through the JSON codec. A row that
      // holds invalid JSON would otherwise throw inside the driver, before
      // `toPreset` could skip it, and take the whole list down with it.
      actions: sql<string>`${triagePresets.actions}`,
      createdAt: triagePresets.createdAt,
      updatedAt: triagePresets.updatedAt,
    })
    .from(triagePresets)
    .where(and(eq(triagePresets.userId, userId), eq(triagePresets.repoId, repoId)))
    .orderBy(triagePresets.name);

  const presets: Preset[] = [];
  for (const row of rows) {
    const preset = toPreset(row);
    if (preset) presets.push(preset);
  }
  return presets;
}

/**
 * Find one preset row owned by the given user.
 *
 * Row scope is always the user, so another user's preset is indistinguishable
 * from one that does not exist. The stored actions are returned unvalidated so
 * the apply route can reject a stale definition with a message rather than
 * silently dropping it.
 *
 * @param userId - The owning user.
 * @param presetId - The preset's primary key.
 * @returns The row, or `null` when the user has no such preset.
 */
export async function findPresetRow(userId: string, presetId: string): Promise<PresetRow | null> {
  const rows = await typedDb
    .select({
      id: triagePresets.id,
      userId: triagePresets.userId,
      repoId: triagePresets.repoId,
      name: triagePresets.name,
      // Raw text for the same reason as the list: a malformed value must be a
      // rejected preset, not a failed lookup that reports "not found".
      actions: sql<string>`${triagePresets.actions}`,
      createdAt: triagePresets.createdAt,
      updatedAt: triagePresets.updatedAt,
    })
    .from(triagePresets)
    .where(and(eq(triagePresets.id, presetId), eq(triagePresets.userId, userId)));
  return rows[0] ?? null;
}

/**
 * Find one preset owned by the given user, with its actions validated.
 *
 * @param userId - The owning user.
 * @param presetId - The preset's primary key.
 * @returns The preset, or `null` when it is missing or its actions are stale.
 */
export async function findPreset(userId: string, presetId: string): Promise<Preset | null> {
  const row = await findPresetRow(userId, presetId);
  return row ? toPreset(row) : null;
}

/**
 * Count how many presets the user already keeps for one repository.
 *
 * @param userId - The owning user.
 * @param repoId - The repository being counted.
 * @returns The number of stored presets, readable or not.
 */
export async function countPresets(userId: string, repoId: string): Promise<number> {
  const rows = await typedDb
    .select({ total: count() })
    .from(triagePresets)
    .where(and(eq(triagePresets.userId, userId), eq(triagePresets.repoId, repoId)));
  return rows[0]?.total ?? 0;
}

/**
 * Insert a preset for the given user and repository.
 *
 * @param input - The owning user, the repository, the name, and validated actions.
 * @returns The created preset.
 */
export async function createPreset(input: {
  userId: string;
  repoId: string;
  name: string;
  actions: PresetActions;
}): Promise<Preset> {
  const rows = await typedDb
    .insert(triagePresets)
    .values({
      userId: input.userId,
      repoId: input.repoId,
      name: input.name,
      actions: input.actions as Record<string, unknown>,
    })
    .returning();

  const preset = toPreset(rows[0]);
  if (!preset) throw new Error("Created preset failed to validate");
  return preset;
}

/**
 * Update a preset the user owns.
 *
 * The `userId` predicate is part of the write, not a check before it, so a
 * forged id cannot turn an update into a cross-user write.
 *
 * @param userId - The owning user.
 * @param presetId - The preset's primary key.
 * @param input - The fields to change.
 * @returns The updated preset, or `null` when the user has no such preset.
 */
export async function updatePreset(
  userId: string,
  presetId: string,
  input: { name?: string; actions?: PresetActions }
): Promise<Preset | null> {
  const values: Partial<typeof triagePresets.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.actions !== undefined) values.actions = input.actions as Record<string, unknown>;

  const rows = await typedDb
    .update(triagePresets)
    .set(values)
    .where(and(eq(triagePresets.id, presetId), eq(triagePresets.userId, userId)))
    .returning();

  const row = rows[0];
  return row ? toPreset(row) : null;
}

/**
 * Delete a preset the user owns.
 *
 * @param userId - The owning user.
 * @param presetId - The preset's primary key.
 * @returns Whether a row was removed.
 */
export async function deletePreset(userId: string, presetId: string): Promise<boolean> {
  const rows = await typedDb
    .delete(triagePresets)
    .where(and(eq(triagePresets.id, presetId), eq(triagePresets.userId, userId)))
    .returning({ id: triagePresets.id });
  return rows.length > 0;
}

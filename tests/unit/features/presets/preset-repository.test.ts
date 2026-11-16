/**
 * @module tests/unit/features/presets/preset-repository
 *
 * The stored `actions` column is free-form JSON, so the repository is where
 * "never trust a stored row" is enforced. These tests pin that the column
 * survives a round trip, that one unreadable row cannot break a list, and that
 * the quota is counted per user and repository.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  countPresets,
  createPreset,
  deletePreset,
  findOwnedRepo,
  findPreset,
  listPresets,
  toPreset,
  updatePreset,
} from "@/features/presets/preset-repository";
import { PRESET_LIMIT_PER_REPO } from "@/features/presets/types";
import { PRESET_ID, REPO_ID, fakeDb, presetRow, repoRow } from "../../support/fake-db";

vi.mock("@/lib/db/query", async () => {
  const { fakeDb } = await import("../../support/fake-db");
  return { typedDb: fakeDb.typedDb };
});
vi.mock("@/lib/logger", () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { apiLogger } from "@/lib/logger";

const fake = fakeDb;
const mockWarn = vi.mocked(apiLogger.warn);

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
});

describe("toPreset", () => {
  it("round-trips stored actions through the JSON column", () => {
    const actions = {
      priority: 2,
      labels: { add: ["bug", "confirmed"] },
      assignees: { add: ["jo"] },
    };
    const preset = toPreset(presetRow({ actions }));

    expect(preset?.actions).toEqual(actions);
    expect(preset?.id).toBe(PRESET_ID);
    expect(preset?.createdAt).toBe("2026-01-04T00:00:00.000Z");
  });

  it("keeps a null priority distinct from an omitted one", () => {
    const clear = toPreset(presetRow({ actions: { priority: null } }));
    const omitted = toPreset(presetRow({ actions: { labels: { add: ["bug"] } } }));

    expect(clear?.actions.priority).toBeNull();
    expect(omitted?.actions.priority).toBeUndefined();
  });

  it("returns null for a row whose stored actions no longer validate", () => {
    const preset = toPreset(presetRow({ actions: { state: "closed" } }));

    expect(preset).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith(
      { presetId: PRESET_ID, repoId: REPO_ID },
      "Stored preset actions failed validation and were skipped"
    );
  });

  it("rejects a row that carries no action at all", () => {
    expect(toPreset(presetRow({ actions: {} }))).toBeNull();
  });

  it("rejects a row that repeats a label", () => {
    expect(toPreset(presetRow({ actions: { labels: { add: ["bug", "bug"] } } }))).toBeNull();
  });
});

describe("listPresets", () => {
  it("skips an invalid row instead of failing the whole list", () => {
    fake.state.rows.triage_preset.push(
      presetRow({ id: "preset-broken", name: "Broken", actions: { state: "closed" } }),
      presetRow({ id: PRESET_ID, name: "A fine preset" })
    );

    const presets = listPresets("user-1", REPO_ID);
    return presets.then((result) => {
      expect(result.map((preset) => preset.id)).toEqual([PRESET_ID]);
    });
  });

  it("only returns the current user's presets", async () => {
    fake.state.rows.triage_preset.push(
      presetRow({ id: "mine", name: "Mine" }),
      presetRow({ id: "theirs", name: "Theirs", userId: "user-2" }),
      presetRow({
        id: "55555555-5555-4555-8555-555555555555",
        name: "Elsewhere",
        repoId: "66666666-6666-4666-8666-666666666666",
      })
    );

    const presets = await listPresets("user-1", REPO_ID);

    expect(presets.map((preset) => preset.id)).toEqual(["mine"]);
  });
});

describe("findPreset", () => {
  it("returns the preset for its owner", async () => {
    fake.state.rows.triage_preset.push(presetRow());

    const preset = await findPreset("user-1", PRESET_ID);

    expect(preset?.name).toBe("Confirmed bug");
  });

  it("returns null for another user's preset", async () => {
    fake.state.rows.triage_preset.push(presetRow({ userId: "user-2" }));

    expect(await findPreset("user-1", PRESET_ID)).toBeNull();
  });

  it("returns null when the stored actions are stale", async () => {
    fake.state.rows.triage_preset.push(presetRow({ actions: { labels: { remove: ["bug"] } } }));

    expect(await findPreset("user-1", PRESET_ID)).toBeNull();
  });
});

describe("countPresets", () => {
  it("counts only the given user's presets for the given repo", async () => {
    fake.state.rows.triage_preset.push(
      presetRow({ id: "p1" }),
      presetRow({ id: "p2" }),
      presetRow({ id: "p3", userId: "user-2" }),
      presetRow({ id: "p4", repoId: "66666666-6666-4666-8666-666666666666" })
    );

    expect(await countPresets("user-1", REPO_ID)).toBe(2);
  });

  it("returns zero for a repo with no presets", async () => {
    expect(await countPresets("user-1", REPO_ID)).toBe(0);
  });

  it("counts unreadable rows too, so a stale row still consumes quota", async () => {
    fake.state.rows.triage_preset.push(presetRow({ actions: { state: "closed" } }));

    expect(await countPresets("user-1", REPO_ID)).toBe(1);
    expect(PRESET_LIMIT_PER_REPO).toBe(100);
  });
});

describe("createPreset", () => {
  it("stores the validated actions and returns the parsed preset", async () => {
    const preset = await createPreset({
      userId: "user-1",
      repoId: REPO_ID,
      name: "Triage me",
      actions: { labels: { add: ["needs-triage"] } },
    });

    expect(preset.name).toBe("Triage me");
    expect(preset.actions).toEqual({ labels: { add: ["needs-triage"] } });
    expect(fake.state.rows.triage_preset).toHaveLength(1);
  });
});

describe("updatePreset", () => {
  it("renames a preset its owner owns", async () => {
    fake.state.rows.triage_preset.push(presetRow());

    const preset = await updatePreset("user-1", PRESET_ID, { name: "Renamed" });

    expect(preset?.name).toBe("Renamed");
    expect(fake.state.rows.triage_preset[0].name).toBe("Renamed");
  });

  it("cannot touch another user's preset", async () => {
    fake.state.rows.triage_preset.push(presetRow({ userId: "user-2" }));

    const preset = await updatePreset("user-1", PRESET_ID, { name: "Hijacked" });

    expect(preset).toBeNull();
    expect(fake.state.rows.triage_preset[0].name).toBe("Confirmed bug");
  });
});

describe("deletePreset", () => {
  it("reports whether a row was removed", async () => {
    fake.state.rows.triage_preset.push(presetRow());

    expect(await deletePreset("user-1", PRESET_ID)).toBe(true);
    expect(await deletePreset("user-1", PRESET_ID)).toBe(false);
  });

  it("does not remove another user's preset", async () => {
    fake.state.rows.triage_preset.push(presetRow({ userId: "user-2" }));

    expect(await deletePreset("user-1", PRESET_ID)).toBe(false);
    expect(fake.state.rows.triage_preset).toHaveLength(1);
  });
});

describe("findOwnedRepo", () => {
  it("returns the repo for its owner", async () => {
    fake.state.rows.repo.push(repoRow());

    expect((await findOwnedRepo("user-1", REPO_ID))?.fullName).toBe("octo/repo");
  });

  it("returns null for another user's repo", async () => {
    fake.state.rows.repo.push(repoRow({ userId: "user-2" }));

    expect(await findOwnedRepo("user-1", REPO_ID)).toBeNull();
  });
});

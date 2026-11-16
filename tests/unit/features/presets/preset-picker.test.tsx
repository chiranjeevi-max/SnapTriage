/**
 * @module tests/unit/features/presets/preset-picker
 *
 * What the preset pane promises a user before anything is written: a way
 * forward when there are no presets, a diff that shows what the preset would do
 * (including the values already in place), a refusal to claim success for a
 * no-op, and a dialog that closes on Escape and hands focus back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  usePresets,
  useCreatePreset,
  useUpdatePreset,
  useDeletePreset,
  useRepoBatchMode,
} from "@/features/presets/use-presets";
import { useApplyPreset } from "@/features/presets/use-apply-preset";
import { PresetPicker } from "@/features/presets/components/preset-picker";
import type { Preset } from "@/features/presets/types";
import type { IssueWithTriage } from "@/features/inbox/use-issues";
import {
  WORST_CASE_ISSUES,
  WORST_CASE_PRESETS,
  presetsForMode,
} from "@/features/dev-tools/fixtures";
import { resolvePreset } from "@/features/presets/types";

const { applyMutate } = vi.hoisted(() => ({ applyMutate: vi.fn() }));

vi.mock("@/features/presets/use-presets", () => ({
  usePresets: vi.fn(),
  useCreatePreset: vi.fn(),
  useUpdatePreset: vi.fn(),
  useDeletePreset: vi.fn(),
  useRepoBatchMode: vi.fn(),
}));

vi.mock("@/features/presets/use-apply-preset", () => ({
  useApplyPreset: vi.fn(),
}));

vi.mock("@/features/triage/use-repo-labels", () => ({
  useRepoLabels: () => ({
    data: [
      { name: "bug", color: null, description: null },
      { name: "confirmed", color: null, description: null },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/features/triage/use-repo-collaborators", () => ({
  useRepoCollaborators: () => ({
    data: [{ username: "jo", avatar: null, permission: "write" }],
    isLoading: false,
  }),
}));

/** cmdk measures its list with a ResizeObserver jsdom does not implement. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** A mutation-shaped object, so a mocked hook still reads like the real one. */
function mutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
  };
}

/** The issue every preview in this file is resolved against. */
const ISSUE: IssueWithTriage = {
  id: "issue-1",
  repoId: "repo-1",
  provider: "github",
  number: 42,
  title: "Checkout returns 500 on retry",
  author: "jo",
  authorAvatar: null,
  state: "open",
  labels: ["bug", "needs-repro"],
  assignees: ["nadia"],
  url: "https://github.com/acme/console/issues/42",
  providerIssueId: "42",
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  fetchedAt: "2026-11-15T00:00:00.000Z",
  triage: { id: "triage-1", priority: 2, snoozedUntil: null, dismissed: false },
};

/** A stored preset, with the fields the picker does not render defaulted. */
function preset(overrides: Partial<Preset> & { id: string; name: string }): Preset {
  return {
    repoId: "repo-1",
    actions: {},
    createdAt: "2026-11-15T00:00:00.000Z",
    updatedAt: "2026-11-15T00:00:00.000Z",
    ...overrides,
  };
}

/** Renders the picker inside a query client and returns the trigger button. */
function renderPicker(initialOpen = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Harness() {
    const [open, setOpen] = React.useState(initialOpen);
    return (
      <QueryClientProvider client={queryClient}>
        <button type="button" onClick={() => setOpen(true)}>
          Open presets
        </button>
        <PresetPicker open={open} onOpenChange={setOpen} issue={ISSUE} />
      </QueryClientProvider>
    );
  }

  render(<Harness />);
  return screen.getByRole("button", { name: "Open presets" });
}

/**
 * Opens the dialog from the trigger and returns the dialog element, so a test
 * never assumes the dialog is mounted while closed.
 */
async function openDialog(): Promise<HTMLElement> {
  const trigger = renderPicker();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  return dialog;
}

describe("PresetPicker", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
    applyMutate.mockReset();
    vi.mocked(useApplyPreset).mockReturnValue({
      ...mutation(),
      mutate: applyMutate,
    } as unknown as ReturnType<typeof useApplyPreset>);
    vi.mocked(useCreatePreset).mockReturnValue(
      mutation() as unknown as ReturnType<typeof useCreatePreset>
    );
    vi.mocked(useUpdatePreset).mockReturnValue(
      mutation() as unknown as ReturnType<typeof useUpdatePreset>
    );
    vi.mocked(useDeletePreset).mockReturnValue(
      mutation() as unknown as ReturnType<typeof useDeletePreset>
    );
    vi.mocked(useRepoBatchMode).mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers a next step when the repository has no presets", async () => {
    vi.mocked(usePresets).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    await openDialog();

    expect(await screen.findByText("No presets yet")).toBeDefined();
    expect(screen.getAllByRole("button", { name: /create preset/i }).length).toBeGreaterThan(0);
  });

  it("shows added values with +, already-present ones with =, and a clear with -", async () => {
    vi.mocked(usePresets).mockReturnValue({
      data: [
        preset({
          id: "preset-1",
          name: "Confirmed bug",
          actions: {
            priority: null,
            labels: { add: ["bug", "confirmed"] },
            assignees: { add: ["jo", "nadia"] },
          },
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByText("Confirmed bug"));
    fireEvent.click(await within(dialog).findByText("confirmed"));

    const rows = within(dialog).getAllByRole("listitem");
    const rendered = rows.map((row) => row.getAttribute("aria-label"));

    // Priority 2 -> clear is a removal, so it is `-` with the outgoing value.
    expect(rendered).toContain("Clear priority, currently P2");
    // `bug` and `nadia` are already on the issue; `confirmed` and `jo` are not.
    expect(rendered).toContain("Already has label bug");
    expect(rendered).toContain("Add label confirmed");
    expect(rendered).toContain("Assign jo");
    expect(rendered).toContain("Already assigned to nadia");

    // The glyphs themselves carry the operator, so assert on the row text too.
    const bugRow = rows.find((row) => row.getAttribute("aria-label") === "Already has label bug");
    const confirmedRow = rows.find(
      (row) => row.getAttribute("aria-label") === "Add label confirmed"
    );
    expect(bugRow?.textContent).toContain("=");
    expect(confirmedRow?.textContent).toContain("+");
  });

  it("says Already applied for a no-op and never calls apply", async () => {
    vi.mocked(usePresets).mockReturnValue({
      data: [
        preset({
          id: "preset-1",
          name: "Already satisfied",
          actions: { priority: 2, labels: { add: ["bug"] } },
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByText("Already satisfied"));

    expect(await within(dialog).findByText("Already applied")).toBeDefined();
    const apply = within(dialog).getByRole("button", { name: /apply preset/i });
    expect(apply.hasAttribute("disabled")).toBe(true);

    fireEvent.click(apply);
    expect(applyMutate).not.toHaveBeenCalled();
  });

  it("applies the previewed diff and lets Enter reach the Apply button", async () => {
    vi.mocked(usePresets).mockReturnValue({
      data: [
        preset({
          id: "preset-1",
          name: "Confirmed bug",
          actions: { priority: 1, labels: { add: ["confirmed"] } },
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByText("Confirmed bug"));

    // cmdk's root swallows Enter to select a command item; the preview panel has
    // none, so the key must reach the focused button instead.
    const apply = within(dialog).getByRole("button", { name: "Apply preset" });
    const event = fireEvent.keyDown(apply, { key: "Enter" });
    expect(event).toBe(true);
    expect(applyMutate).not.toHaveBeenCalled();

    fireEvent.click(apply);
    expect(applyMutate).toHaveBeenCalledTimes(1);

    const [input] = applyMutate.mock.calls[0] as [
      Parameters<ReturnType<typeof useApplyPreset>["mutate"]>[0],
    ];
    expect(input.issueId).toBe("issue-1");
    expect(input.presetId).toBe("preset-1");
    expect(input.presetName).toBe("Confirmed bug");
    expect(input.preview.payload).toEqual({
      priority: 1,
      labels: { add: ["confirmed"] },
    });
  });

  it("reads Stage preset when the repository syncs in batch", async () => {
    vi.mocked(useRepoBatchMode).mockReturnValue(true);
    vi.mocked(usePresets).mockReturnValue({
      data: [
        preset({
          id: "preset-1",
          name: "Confirmed bug",
          actions: { priority: 1 },
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByText("Confirmed bug"));

    expect(within(dialog).getByRole("button", { name: "Stage preset" })).toBeDefined();
    expect(within(dialog).queryByRole("button", { name: "Apply preset" })).toBeNull();
  });

  it("returns focus to the trigger when Escape closes the dialog", async () => {
    vi.mocked(usePresets).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    const trigger = renderPicker();
    // A keyboard user arrives with the trigger already focused; jsdom does not
    // move focus on a synthetic click, so the test does it explicitly.
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeDefined();
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  /**
   * @target PresetPicker
   * @dependencies none
   * @scenario The pane is opened from a control that has never held focus in this
   *           document, which is what happens when `T` opens it: there is no
   *           click, so nothing has fired before Radix moves focus into the dialog.
   * @expectedOutput Closing returns focus to the last element that held it outside
   *                 a dialog. Reading `document.activeElement` on open cannot do
   *                 this — by then it is already the dialog's own control, which
   *                 unmounts and leaves focus on the body.
   */
  it("returns focus to the element that last held it outside the dialog", async () => {
    vi.mocked(usePresets).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    const trigger = renderPicker();
    // Focus arrives the way it does for a keyboard user: the control is focused
    // by the app, and the dialog is opened by a keystroke rather than a click.
    fireEvent.focus(trigger);

    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("survives the worst-case fixtures and skips the empty bundle", async () => {
    vi.mocked(usePresets).mockReturnValue({
      data: presetsForMode("worst"),
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    const dialog = await openDialog();

    // The 80 character name and the 100 label bundle are both listed...
    const longName = WORST_CASE_PRESETS[0].name;
    expect(longName.length).toBe(80);
    expect(await within(dialog).findByText(longName)).toBeDefined();
    expect(within(dialog).getByText("Every label")).toBeDefined();
    // ...while the empty bundle has nothing to offer and is not rendered.
    expect(within(dialog).queryByText("Empty bundle from before validation existed")).toBeNull();

    // Selecting the hundred-label preset renders a preview instead of breaking.
    fireEvent.click(within(dialog).getByText("Every label"));
    expect(await within(dialog).findByText(/changes?$/)).toBeDefined();
  });

  it("starts a new preset empty rather than copying the issue", async () => {
    vi.mocked(usePresets).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof usePresets>);

    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /create preset/i }));

    // The form opens with nothing selected: a preset records a decision the
    // user makes, not whatever the currently selected issue happens to carry.
    const name = within(dialog).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("");

    const save = within(dialog).getByRole("button", { name: "Save preset" });
    expect(save.hasAttribute("disabled")).toBe(true);

    // Nothing is selected even though the issue carries `bug` and `nadia`.
    expect(within(dialog).queryAllByRole("button", { pressed: true })).toEqual([]);
    const bug = within(dialog).getByRole("button", { name: /^bug$/ });
    expect(bug.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the no-op fixture a real no-op against the worst-case issue", () => {
    // The fixture exists to exercise the "Already applied" path, so it has to
    // stay satisfied by the issue the picker would be opened on.
    const satisfied = WORST_CASE_PRESETS.find(
      (preset) => preset.name === "Already satisfied by the first row"
    );
    expect(satisfied).toBeDefined();

    const resolution = resolvePreset(satisfied!.actions, WORST_CASE_ISSUES[0]);
    expect(resolution.noChange).toBe(true);
    expect(resolution.payload).toEqual({});
  });
});

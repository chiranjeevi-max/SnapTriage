/**
 * @module lib/validations
 *
 * Centralized Zod schemas for API request body validation.
 * Used across all API routes to ensure type-safe, validated input.
 */
import { z } from "zod";
import { providerLimits } from "./provider-interface";

/** Schema for PATCH /api/issues/:id: triage update payload. */
export const triagePatchSchema = z.object({
  priority: z.number().int().min(0).max(3).nullable().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  dismissed: z.boolean().optional(),
  labels: z
    .object({
      add: z.array(z.string().max(256)).max(100).optional(),
      remove: z.array(z.string().max(256)).max(100).optional(),
    })
    .optional(),
  assignees: z
    .object({
      add: z.array(z.string().max(256)).max(100).optional(),
      remove: z.array(z.string().max(256)).max(100).optional(),
    })
    .optional(),
  state: z.enum(["open", "closed"]).optional(),
  batch: z.boolean().optional(),
});

export type TriagePatchInput = z.infer<typeof triagePatchSchema>;

/**
 * Schema for POST /api/repos: connect a new repository.
 *
 * Only the coordinates the provider API is called with are accepted. The
 * repository's full name and its permission are derived server-side: a client
 * that could name the stored repo freely would be able to attach a webhook
 * for a repository it does not own.
 *
 * The length limits are the provider's own, so a repository the provider would
 * refuse is never stored and the derived full name is always a name the
 * provider can have.
 */
export const connectRepoSchema = z
  .discriminatedUnion("provider", [
    z.object({
      provider: z.literal("github"),
      owner: z.string().min(1).max(providerLimits.github.owner),
      name: z.string().min(1).max(providerLimits.github.name),
    }),
    z.object({
      provider: z.literal("gitlab"),
      owner: z.string().min(1).max(providerLimits.gitlab.owner),
      name: z.string().min(1).max(providerLimits.gitlab.name),
    }),
  ])
  .superRefine((data, ctx) => {
    const limits = providerLimits[data.provider];
    if (`${data.owner}/${data.name}`.length > limits.path) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: `The full name is limited to ${limits.path} characters on ${data.provider}`,
      });
    }
  });

export type ConnectRepoInput = z.infer<typeof connectRepoSchema>;

/** Schema for PATCH /api/repos/:id: repo settings update. */
export const updateRepoSchema = z
  .object({
    syncMode: z.enum(["live", "batch"]).optional(),
    syncEnabled: z.boolean().optional(),
  })
  .refine((data) => data.syncMode !== undefined || data.syncEnabled !== undefined, {
    message: "At least one field is required",
  });

export type UpdateRepoInput = z.infer<typeof updateRepoSchema>;

/** Schema for POST /api/sync: trigger sync. */
export const syncTriggerSchema = z.object({
  repoId: z.string().uuid().optional(),
});

export type SyncTriggerInput = z.infer<typeof syncTriggerSchema>;

/**
 * Schema for the action bundle stored inside a triage preset.
 *
 * A preset may carry labels, assignees, and personal priority. Snooze, dismiss,
 * and state are deliberately absent: one keystroke must not close an issue or
 * hide it from the queue when the preview only shows metadata changes.
 *
 * A name may not be repeated within a field, and at least one action must
 * survive, so a preset can never be saved in a state that does nothing.
 */
export const presetActionsSchema = z
  .object({
    priority: z.number().int().min(0).max(3).nullable().optional(),
    labels: z
      .object({
        add: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
      })
      .strict()
      .optional(),
    assignees: z
      .object({
        add: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasPriority = data.priority !== undefined;
    const hasLabels = (data.labels?.add?.length ?? 0) > 0;
    const hasAssignees = (data.assignees?.add?.length ?? 0) > 0;

    if (!hasPriority && !hasLabels && !hasAssignees) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "A preset needs at least one action",
      });
    }

    for (const field of ["labels", "assignees"] as const) {
      const values = data[field]?.add;
      if (!values) continue;
      const seen = new Set<string>();
      for (const value of values) {
        const key = value.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: [field, "add"],
            message: `"${value}" is listed more than once`,
          });
        }
        seen.add(key);
      }
    }
  });

export type PresetActionsInput = z.infer<typeof presetActionsSchema>;

/** Schema for POST /api/presets: create a personal preset. */
export const createPresetSchema = z.object({
  repoId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  actions: presetActionsSchema,
});

export type CreatePresetInput = z.infer<typeof createPresetSchema>;

/** Schema for PATCH /api/presets/:id: rename and/or replace the actions. */
export const updatePresetSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    actions: presetActionsSchema.optional(),
  })
  .strict()
  .refine((data) => data.name !== undefined || data.actions !== undefined, {
    message: "At least one field is required",
  });

export type UpdatePresetInput = z.infer<typeof updatePresetSchema>;

/**
 * Schema for POST /api/issues/:id/apply-preset.
 *
 * `presetId` names the preset to read on the server; the client never sends
 * the actions themselves. A repo or preset that changed since the preview is
 * rejected rather than applied on stale terms.
 */
export const applyPresetSchema = z.object({
  presetId: z.string().uuid(),
  batch: z.boolean().optional(),
});

export type ApplyPresetInput = z.infer<typeof applyPresetSchema>;

/**
 * Schema for PUT /api/issues/:id/draft: save the reply draft for one issue.
 *
 * `expectedVersion` is the version the editor last read. The server updates
 * conditionally on it, so two tabs autosaving the same draft cannot silently
 * overwrite each other; the stale writer is told to reload instead. A brand new
 * draft is created with `expectedVersion: 0`, which is what the unique key on
 * `(issueId, userId)` arbitrates.
 *
 * The body limit is checked against the provider at send time, not here, because
 * the schema runs before the repository is known.
 */
export const saveDraftSchema = z.object({
  body: z.string().max(1_000_000),
  // Bounded to the Postgres `integer` range. `.int()` alone accepts values a
  // `bigint` column would take but an `integer` column rejects, so the check
  // would pass here and fail at the driver.
  expectedVersion: z.number().int().min(0).max(2_147_483_647),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

/**
 * Schema for POST /api/issues/:id/replies: publish the draft as a comment.
 *
 * `expectedVersion` is the draft version the composer was showing. Without it a
 * tab left open on an older copy could post superseded text and then delete the
 * newer draft on success. Omitted when the composer holds no stored draft.
 */
export const sendReplySchema = z.object({
  // Not trimmed: leading indentation is code, and trailing spaces are hard line
  // breaks in Markdown. Whitespace-only input is rejected without rewriting it.
  body: z
    .string()
    .refine((value) => value.trim().length > 0, "A reply needs some text")
    .max(1_000_000),
  expectedVersion: z.number().int().min(1).max(2_147_483_647).optional(),
});

export type SendReplyInput = z.infer<typeof sendReplySchema>;

/** Schema for POST /api/saved-replies: create a personal reply template. */
export const createSavedReplySchema = z.object({
  name: z.string().trim().min(1).max(80),
  body: z
    .string()
    .refine((value) => value.trim().length > 0, "A saved reply needs some text")
    .max(1_000_000),
});

export type CreateSavedReplyInput = z.infer<typeof createSavedReplySchema>;

/** Schema for PATCH /api/saved-replies/:id. */
export const updateSavedReplySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    body: z
      .string()
      .refine((value) => value.trim().length > 0, "A saved reply needs some text")
      .max(1_000_000)
      .optional(),
  })
  .strict()
  .refine((data) => data.name !== undefined || data.body !== undefined, {
    message: "At least one field is required",
  });

export type UpdateSavedReplyInput = z.infer<typeof updateSavedReplySchema>;

/**
 * Schema for PUT /api/issues/:id/follow-up: arm or update a follow-up.
 *
 * `action` is an explicit transition rather than a boolean, because "wait",
 * "review", and "stop" have different consequences and a boolean would let a
 * client express only two of them.
 */
export const followUpActionSchema = z.object({
  action: z.enum(["wait", "review", "stop"]),
});

export type FollowUpActionInput = z.infer<typeof followUpActionSchema>;

/** Schema for POST /api/auth/token: PAT validation. */
export const tokenValidationSchema = z.object({
  token: z.string().min(1).max(512),
  provider: z.enum(["github", "gitlab"]),
});

export type TokenValidationInput = z.infer<typeof tokenValidationSchema>;

/**
 * Helper to parse and validate a request body against a Zod schema.
 * Returns either the validated data or a formatted error message.
 */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  return { success: false, error: messages.join("; ") };
}

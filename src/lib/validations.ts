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

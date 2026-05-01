/**
 * @module lib/validations
 *
 * Centralized Zod schemas for API request body validation.
 * Used across all API routes to ensure type-safe, validated input.
 */
import { z } from "zod";

/** Schema for PATCH /api/issues/:id — triage update payload. */
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

/** Schema for POST /api/repos — connect a new repository. */
export const connectRepoSchema = z.object({
  provider: z.enum(["github", "gitlab"]),
  owner: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  fullName: z.string().min(1).max(512),
  permission: z.enum(["admin", "write", "read"]).optional().default("read"),
  description: z.string().max(1024).nullable().optional(),
  isPrivate: z.boolean().optional(),
});

export type ConnectRepoInput = z.infer<typeof connectRepoSchema>;

/** Schema for POST /api/sync — trigger sync. */
export const syncTriggerSchema = z.object({
  repoId: z.string().uuid().optional(),
});

export type SyncTriggerInput = z.infer<typeof syncTriggerSchema>;

/** Schema for POST /api/auth/token — PAT validation. */
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
  const messages = result.error.issues.map(
    (i) => `${i.path.join(".")}: ${i.message}`
  );
  return { success: false, error: messages.join("; ") };
}

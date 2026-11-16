/**
 * @module presets/api-error
 *
 * Reads the server's own sentence out of a failed preset response.
 *
 * The preset routes reject a write with a specific reason — a name over the
 * provider's label limit, a missing token, a full quota, a preset and issue in
 * different repositories. The toast is the only place a user ever sees that
 * sentence, so replacing it with "something went wrong" would delete the one
 * piece of information that tells them what to change.
 */

/**
 * Extracts the `error` field from a failed API response.
 *
 * @param res - The non-ok response.
 * @param fallback - A sentence for a response whose body carries no message.
 * @returns The server's message, or the fallback when there is none.
 */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim().length > 0) return body.error;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * @module webhooks/delivery-store
 *
 * Persistence for seen webhook deliveries.
 *
 * The store is what makes the webhook endpoint idempotent: a delivery ID is
 * recorded before the sync runs, so a re-sent or replayed delivery is ignored
 * instead of triggering the work twice.
 */
import { eq, lt } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { webhookDeliveries } from "@/lib/db/schema";

/**
 * How long a delivery ID stays on record.
 *
 * Long enough to cover every provider's redelivery horizon; a delivery older
 * than this is not replayed in practice, and the row would only cost space.
 */
export const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Records a delivery ID and reports whether it is new.
 *
 * The insert is a single atomic `INSERT ... ON CONFLICT DO NOTHING`, so two
 * concurrent copies of the same delivery cannot both be treated as first.
 *
 * @param provider - Provider the delivery came from ("github" | "gitlab").
 * @param deliveryId - Provider-assigned delivery identifier.
 * @returns True when the delivery had not been seen before.
 */
export async function recordDelivery(provider: string, deliveryId: string): Promise<boolean> {
  const result = await typedDb
    .insert(webhookDeliveries)
    .values({ deliveryId: `${provider}:${deliveryId}`, provider, receivedAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });

  return result.length > 0;
}

/**
 * Removes a delivery record again.
 *
 * Used when the work the delivery triggered failed: leaving the record in place
 * would make the delivery unretryable, because a later re-delivery of the same
 * ID would be treated as a replay.
 *
 * @param provider - Provider the delivery came from.
 * @param deliveryId - Provider-assigned delivery identifier.
 */
export async function forgetDelivery(provider: string, deliveryId: string): Promise<void> {
  await typedDb
    .delete(webhookDeliveries)
    .where(eq(webhookDeliveries.deliveryId, `${provider}:${deliveryId}`));
}

/**
 * Deletes delivery records that are past their retention window.
 *
 * Best-effort cleanup: the table is bounded by the retention window, and a
 * failed purge must not fail the delivery that triggered it.
 */
export async function purgeExpiredDeliveries(now = Date.now()): Promise<void> {
  try {
    await typedDb
      .delete(webhookDeliveries)
      .where(lt(webhookDeliveries.receivedAt, new Date(now - DELIVERY_RETENTION_MS)));
  } catch {
    // Cleanup is opportunistic; a failure here only delays the reclaim.
  }
}

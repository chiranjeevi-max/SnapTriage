DROP INDEX "follow_up_due_idx";--> statement-breakpoint
CREATE INDEX "follow_up_due_idx" ON "follow_up" USING btree ("userId","state","attemptedAt" NULLS FIRST,"checkedAt" NULLS FIRST);
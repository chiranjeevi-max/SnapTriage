ALTER TABLE "reply_draft" ADD COLUMN "sendClaimId" text;--> statement-breakpoint
ALTER TABLE "reply_draft" ADD COLUMN "sendInFlightUntil" bigint;
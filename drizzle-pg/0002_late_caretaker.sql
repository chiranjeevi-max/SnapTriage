CREATE TABLE "follow_up" (
	"id" text PRIMARY KEY NOT NULL,
	"issueId" text NOT NULL,
	"userId" text NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"lastSeenCommentId" text,
	"lastSeenCommentAt" bigint,
	"stateAtBaseline" text DEFAULT 'open' NOT NULL,
	"reviewedCommentId" text,
	"reason" text,
	"checkedAt" bigint,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"login" text NOT NULL,
	"avatar" text,
	"fetchedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reply_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"issueId" text NOT NULL,
	"userId" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sendAttemptedAt" bigint,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_reply" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage_preset" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"repoId" text NOT NULL,
	"name" text NOT NULL,
	"actions" text DEFAULT '{}' NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_issueId_issue_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_identity" ADD CONSTRAINT "provider_identity_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_draft" ADD CONSTRAINT "reply_draft_issueId_issue_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_draft" ADD CONSTRAINT "reply_draft_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reply" ADD CONSTRAINT "saved_reply_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_preset" ADD CONSTRAINT "triage_preset_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_preset" ADD CONSTRAINT "triage_preset_repoId_repo_id_fk" FOREIGN KEY ("repoId") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_issue_user_unique" ON "follow_up" USING btree ("issueId","userId");--> statement-breakpoint
CREATE INDEX "follow_up_user_state_idx" ON "follow_up" USING btree ("userId","state");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_identity_user_provider_unique" ON "provider_identity" USING btree ("userId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_draft_issue_user_unique" ON "reply_draft" USING btree ("issueId","userId");--> statement-breakpoint
CREATE INDEX "reply_draft_userId_idx" ON "reply_draft" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "saved_reply_userId_idx" ON "saved_reply" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "triage_preset_userId_repoId_idx" ON "triage_preset" USING btree ("userId","repoId");--> statement-breakpoint
CREATE INDEX "triage_preset_repoId_idx" ON "triage_preset" USING btree ("repoId");
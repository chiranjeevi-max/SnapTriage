CREATE TABLE "access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"createdAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "issue" (
	"id" text PRIMARY KEY NOT NULL,
	"repoId" text NOT NULL,
	"provider" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"author" text,
	"authorAvatar" text,
	"state" text DEFAULT 'open' NOT NULL,
	"labels" text DEFAULT '[]' NOT NULL,
	"assignees" text DEFAULT '[]' NOT NULL,
	"url" text NOT NULL,
	"providerIssueId" text NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"fetchedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_bucket" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"windowStart" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"fullName" text NOT NULL,
	"permission" text DEFAULT 'read' NOT NULL,
	"syncEnabled" boolean DEFAULT true NOT NULL,
	"syncMode" text DEFAULT 'live' NOT NULL,
	"lastSyncedAt" bigint,
	"createdAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"filter" text DEFAULT 'all' NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"repoId" text NOT NULL,
	"status" text NOT NULL,
	"issuesFetched" integer DEFAULT 0,
	"error" text,
	"startedAt" bigint NOT NULL,
	"completedAt" bigint
);
--> statement-breakpoint
CREATE TABLE "triage_state" (
	"id" text PRIMARY KEY NOT NULL,
	"issueId" text NOT NULL,
	"userId" text NOT NULL,
	"priority" integer,
	"snoozedUntil" bigint,
	"dismissed" boolean DEFAULT false NOT NULL,
	"batchPending" boolean DEFAULT false NOT NULL,
	"pendingChanges" text DEFAULT '{}',
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" bigint,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" bigint NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"provider" text NOT NULL,
	"receivedAt" bigint NOT NULL,
	CONSTRAINT "webhook_delivery_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_repoId_repo_id_fk" FOREIGN KEY ("repoId") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo" ADD CONSTRAINT "repo_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_repoId_repo_id_fk" FOREIGN KEY ("repoId") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_state" ADD CONSTRAINT "triage_state_issueId_issue_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_state" ADD CONSTRAINT "triage_state_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_token_user_provider_unique" ON "access_token" USING btree ("userId","provider");--> statement-breakpoint
CREATE INDEX "issue_repoId_idx" ON "issue" USING btree ("repoId");--> statement-breakpoint
CREATE INDEX "issue_state_idx" ON "issue" USING btree ("state");--> statement-breakpoint
CREATE INDEX "issue_provider_issueId_idx" ON "issue" USING btree ("provider","providerIssueId");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_repo_provider_issue_unique" ON "issue" USING btree ("repoId","providerIssueId");--> statement-breakpoint
CREATE INDEX "rate_limit_bucket_windowStart_idx" ON "rate_limit_bucket" USING btree ("windowStart");--> statement-breakpoint
CREATE INDEX "repo_userId_idx" ON "repo" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "repo_provider_fullName_idx" ON "repo" USING btree ("provider","fullName");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_user_provider_fullName_unique" ON "repo" USING btree ("userId","provider","fullName");--> statement-breakpoint
CREATE INDEX "saved_view_userId_idx" ON "saved_view" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "syncLog_repoId_idx" ON "sync_log" USING btree ("repoId");--> statement-breakpoint
CREATE INDEX "triage_issueId_userId_idx" ON "triage_state" USING btree ("issueId","userId");--> statement-breakpoint
CREATE INDEX "triage_userId_idx" ON "triage_state" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "triage_issue_user_unique" ON "triage_state" USING btree ("issueId","userId");--> statement-breakpoint
CREATE INDEX "webhook_delivery_receivedAt_idx" ON "webhook_delivery" USING btree ("receivedAt");
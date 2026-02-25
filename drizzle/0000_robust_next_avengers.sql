CREATE TABLE `access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`token` text NOT NULL,
	`label` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issue` (
	`id` text PRIMARY KEY NOT NULL,
	`repoId` text NOT NULL,
	`provider` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`author` text,
	`authorAvatar` text,
	`state` text DEFAULT 'open' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`assignees` text DEFAULT '[]' NOT NULL,
	`url` text NOT NULL,
	`providerIssueId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`fetchedAt` integer NOT NULL,
	FOREIGN KEY (`repoId`) REFERENCES `repo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_repoId_idx` ON `issue` (`repoId`);--> statement-breakpoint
CREATE INDEX `issue_state_idx` ON `issue` (`state`);--> statement-breakpoint
CREATE INDEX `issue_provider_issueId_idx` ON `issue` (`provider`,`providerIssueId`);--> statement-breakpoint
CREATE TABLE `repo` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`fullName` text NOT NULL,
	`permission` text DEFAULT 'read' NOT NULL,
	`syncEnabled` integer DEFAULT true NOT NULL,
	`syncMode` text DEFAULT 'live' NOT NULL,
	`lastSyncedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repo_userId_idx` ON `repo` (`userId`);--> statement-breakpoint
CREATE INDEX `repo_provider_fullName_idx` ON `repo` (`provider`,`fullName`);--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` text PRIMARY KEY NOT NULL,
	`repoId` text NOT NULL,
	`status` text NOT NULL,
	`issuesFetched` integer DEFAULT 0,
	`error` text,
	`startedAt` integer NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`repoId`) REFERENCES `repo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `syncLog_repoId_idx` ON `sync_log` (`repoId`);--> statement-breakpoint
CREATE TABLE `triage_state` (
	`id` text PRIMARY KEY NOT NULL,
	`issueId` text NOT NULL,
	`userId` text NOT NULL,
	`priority` integer,
	`snoozedUntil` integer,
	`dismissed` integer DEFAULT false NOT NULL,
	`batchPending` integer DEFAULT false NOT NULL,
	`pendingChanges` text DEFAULT '{}',
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`issueId`) REFERENCES `issue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `triage_issueId_userId_idx` ON `triage_state` (`issueId`,`userId`);--> statement-breakpoint
CREATE INDEX `triage_userId_idx` ON `triage_state` (`userId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);

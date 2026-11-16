CREATE TABLE `follow_up` (
	`id` text PRIMARY KEY NOT NULL,
	`issueId` text NOT NULL,
	`userId` text NOT NULL,
	`state` text DEFAULT 'waiting' NOT NULL,
	`lastSeenCommentId` text,
	`lastSeenCommentAt` integer,
	`stateAtBaseline` text DEFAULT 'open' NOT NULL,
	`reviewedCommentId` text,
	`reason` text,
	`checkedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`issueId`) REFERENCES `issue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_up_issue_user_unique` ON `follow_up` (`issueId`,`userId`);--> statement-breakpoint
CREATE INDEX `follow_up_user_state_idx` ON `follow_up` (`userId`,`state`);--> statement-breakpoint
CREATE TABLE `provider_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`login` text NOT NULL,
	`avatar` text,
	`fetchedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_identity_user_provider_unique` ON `provider_identity` (`userId`,`provider`);--> statement-breakpoint
CREATE TABLE `reply_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`issueId` text NOT NULL,
	`userId` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`sendAttemptedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`issueId`) REFERENCES `issue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reply_draft_issue_user_unique` ON `reply_draft` (`issueId`,`userId`);--> statement-breakpoint
CREATE INDEX `reply_draft_userId_idx` ON `reply_draft` (`userId`);--> statement-breakpoint
CREATE TABLE `saved_reply` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_reply_userId_idx` ON `saved_reply` (`userId`);--> statement-breakpoint
CREATE TABLE `triage_preset` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`repoId` text NOT NULL,
	`name` text NOT NULL,
	`actions` text DEFAULT '{}' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repoId`) REFERENCES `repo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `triage_preset_userId_repoId_idx` ON `triage_preset` (`userId`,`repoId`);--> statement-breakpoint
CREATE INDEX `triage_preset_repoId_idx` ON `triage_preset` (`repoId`);
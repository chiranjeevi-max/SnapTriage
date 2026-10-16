CREATE UNIQUE INDEX `access_token_user_provider_unique` ON `access_token` (`userId`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `repo_user_provider_fullName_unique` ON `repo` (`userId`,`provider`,`fullName`);--> statement-breakpoint
CREATE UNIQUE INDEX `triage_issue_user_unique` ON `triage_state` (`issueId`,`userId`);
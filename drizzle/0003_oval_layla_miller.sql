CREATE TABLE `rate_limit_bucket` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`windowStart` integer NOT NULL
);

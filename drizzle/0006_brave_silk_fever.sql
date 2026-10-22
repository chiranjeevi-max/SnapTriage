CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`provider` text NOT NULL,
	`receivedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_delivery_id_unique` ON `webhook_delivery` (`delivery_id`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_receivedAt_idx` ON `webhook_delivery` (`receivedAt`);
CREATE TABLE `auth_account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_auth_account_user_id_auth_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`key_hash` text NOT NULL UNIQUE,
	`key_prefix` text NOT NULL,
	`tunnel_id` text NOT NULL,
	`name` text NOT NULL,
	`types` text NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`updated_at` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_api_keys_tunnel_id_tunnels_id_fk` FOREIGN KEY (`tunnel_id`) REFERENCES `tunnels`(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`details` text,
	`updated_at` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY,
	`tunnel_id` text NOT NULL,
	`slug` text,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_collections_tunnel_id_tunnels_id_fk` FOREIGN KEY (`tunnel_id`) REFERENCES `tunnels`(`id`) ON DELETE CASCADE,
	CONSTRAINT `unique_collection_tunnelId_name` UNIQUE(`tunnel_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `endpoints` (
	`id` text PRIMARY KEY,
	`collection_id` text NOT NULL,
	`path_name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_paused` integer DEFAULT false NOT NULL,
	`updated_at` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_endpoints_collection_id_collections_id_fk` FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ingress_signing` (
	`tunnel_id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	CONSTRAINT `fk_ingress_signing_tunnel_id_tunnels_id_fk` FOREIGN KEY (`tunnel_id`) REFERENCES `tunnels`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_auth_session_user_id_auth_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `tunnels` (
	`id` text PRIMARY KEY,
	`org_id` text DEFAULT 'default' NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`allowed_provider_ips` text,
	`denied_provider_ips` text,
	`allowed_agent_ips` text,
	`denied_agent_ips` text,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'admin' NOT NULL,
	`org_id` text,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`trigger` text NOT NULL,
	`replay_of_delivery_id` text,
	`relay_status` text,
	`relayed_at` integer,
	`response_status` integer,
	`latency_ms` integer,
	`response_bytes` integer,
	`status` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	`received_at` integer,
	CONSTRAINT `fk_webhook_deliveries_event_id_webhook_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `webhook_events`(`id`),
	CONSTRAINT `fk_webhook_deliveries_endpoint_id_endpoints_id_fk` FOREIGN KEY (`endpoint_id`) REFERENCES `endpoints`(`id`),
	CONSTRAINT `fk_webhook_deliveries_replay_of_delivery_id_webhook_deliveries_id_fk` FOREIGN KEY (`replay_of_delivery_id`) REFERENCES `webhook_deliveries`(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY,
	`method` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`query_params` text NOT NULL,
	`raw_query` text,
	`headers` text NOT NULL,
	`source_ip` text NOT NULL,
	`user_agent` text,
	`provider_delivery_id` text,
	`collection_id` text,
	`endpoint_path` text,
	`delivery_prepared_at` integer,
	`prepare_attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`status` integer DEFAULT 200 NOT NULL,
	`tunnel_id` text NOT NULL,
	`received_at` integer NOT NULL,
	`payload` blob,
	CONSTRAINT `fk_webhook_events_tunnel_id_tunnels_id_fk` FOREIGN KEY (`tunnel_id`) REFERENCES `tunnels`(`id`)
);
--> statement-breakpoint
CREATE INDEX `auth_account_user` ON `auth_account` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_action` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_entity_type` ON `audit_logs` (`entity_type`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_entity_id` ON `audit_logs` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `auth_session_user` ON `auth_session` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tunnels_slug` ON `tunnels` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_deliveries_event` ON `webhook_deliveries` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_deliveries_status_endpoint` ON `webhook_deliveries` (`status`,`endpoint_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_deliveries_live_endpoint` ON `webhook_deliveries` (`event_id`,`endpoint_id`) WHERE "webhook_deliveries"."trigger" = 'live';--> statement-breakpoint
CREATE INDEX `idx_events_tunnel_received` ON `webhook_events` (`tunnel_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `idx_events_unprepared` ON `webhook_events` (`received_at`,`id`) WHERE "webhook_events"."delivery_prepared_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_provider_delivery` ON `webhook_events` (`tunnel_id`,`provider_delivery_id`);
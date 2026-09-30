CREATE TABLE `local_config` (
	`server_url` text NOT NULL,
	`tunnel_slug` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`base` text,
	`dirty` integer DEFAULT false NOT NULL,
	`conflict` text,
	CONSTRAINT `local_config_pk` PRIMARY KEY(`server_url`, `tunnel_slug`, `kind`, `id`)
);
--> statement-breakpoint
CREATE TABLE `local_config_state` (
	`server_url` text NOT NULL,
	`tunnel_slug` text NOT NULL,
	`tunnel_id` text NOT NULL,
	`last_synced_at` integer,
	`error` text,
	CONSTRAINT `local_config_state_pk` PRIMARY KEY(`server_url`, `tunnel_slug`)
);
--> statement-breakpoint
CREATE TABLE `local_deliveries` (
	`id` text PRIMARY KEY,
	`webhook_id` text NOT NULL,
	`tunnel_id` text NOT NULL,
	`destination_id` text,
	`org_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`target_url` text NOT NULL,
	`status_code` integer NOT NULL,
	`latency_ms` real NOT NULL,
	`request_headers` text,
	`request_body` text,
	`response_headers` text,
	`response_body` text,
	`delivered_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `local_endpoint_secrets` (
	`server_url` text NOT NULL,
	`tunnel_slug` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`header_name` text NOT NULL,
	`secret` text NOT NULL,
	CONSTRAINT `local_endpoint_secrets_pk` PRIMARY KEY(`server_url`, `tunnel_slug`, `endpoint_id`)
);
--> statement-breakpoint
CREATE TABLE `local_endpoint_targets` (
	`server_url` text NOT NULL,
	`tunnel_slug` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`url` text NOT NULL,
	CONSTRAINT `local_endpoint_targets_pk` PRIMARY KEY(`server_url`, `tunnel_slug`, `endpoint_id`)
);
--> statement-breakpoint
CREATE TABLE `local_events` (
	`id` text PRIMARY KEY,
	`tunnel_id` text NOT NULL,
	`org_id` text DEFAULT 'default' NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`method` text NOT NULL,
	`url` text,
	`headers` text NOT NULL,
	`query_params` text,
	`body` text,
	`payload` blob,
	`payload_text` text,
	`is_binary` integer DEFAULT 0,
	`size_bytes` integer DEFAULT 0,
	`attempts` integer DEFAULT 0,
	`replay_count` integer DEFAULT 0,
	`status` integer DEFAULT 200,
	`execution_time_ms` real DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `local_relay_keys` (
	`server_url` text NOT NULL,
	`tunnel_slug` text NOT NULL,
	`api_key` text NOT NULL,
	CONSTRAINT `local_relay_keys_pk` PRIMARY KEY(`server_url`, `tunnel_slug`)
);
--> statement-breakpoint
CREATE TABLE `local_relay_packages` (
	`id` text NOT NULL,
	`server_url` text NOT NULL,
	`tunnel_slug` text NOT NULL,
	`event_id` text NOT NULL,
	`metadata` text NOT NULL,
	`project_id` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`reported_at` integer,
	`ack` text,
	`result` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `local_relay_packages_pk` PRIMARY KEY(`server_url`, `id`)
);
--> statement-breakpoint
CREATE TABLE `local_relay_sessions` (
	`server_url` text NOT NULL,
	`tunnel_slug` text NOT NULL,
	`tunnel_id` text NOT NULL,
	`project_id` text DEFAULT 'default' NOT NULL,
	`is_paused` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	CONSTRAINT `local_relay_sessions_pk` PRIMARY KEY(`server_url`, `tunnel_slug`)
);
--> statement-breakpoint
CREATE TABLE `local_relay_tombstones` (
	`server_url` text NOT NULL,
	`id` text NOT NULL,
	`tunnel_slug` text NOT NULL,
	`event_id` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `local_relay_tombstones_pk` PRIMARY KEY(`server_url`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_deliveries_webhook` ON `local_deliveries` (`webhook_id`);--> statement-breakpoint
CREATE INDEX `idx_events_proj` ON `local_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_tunnel` ON `local_events` (`tunnel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_relay_pending` ON `local_relay_packages` (`server_url`,`tunnel_slug`,`completed`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_relay_event` ON `local_relay_packages` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_relay_session_alias` ON `local_relay_sessions` (`tunnel_id`);--> statement-breakpoint
CREATE INDEX `idx_relay_dedupe_expiry` ON `local_relay_tombstones` (`expires_at`);
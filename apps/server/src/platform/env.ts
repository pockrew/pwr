// @server-only
import { z } from "zod";

export const ServerEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(18787),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DB_FILE_NAME: z.string().min(1).default("data/pwr.sqlite"),
  // Rotating JSON Lines server log read by Admin; defaults to `logs/` beside the database.
  LOG_DIR: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().min(1).optional(),
  ),
  // Required in production (see parseEnv): Better Auth origins and secure cookies derive from it.
  PUBLIC_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  WEBHOOK_SIGNING_ENCRYPTION_KEY: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
  ),
  ADMIN_EMAIL: z.email().transform((value) => value.toLowerCase()),
  ADMIN_PASSWORD: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().min(8).max(128).optional(),
  ),
  ADMIN_NAME: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().min(1).default("Admin"),
  ),
  MAX_INGRESS_PAYLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  TUNNEL_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(50),
  IP_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(100),
  TUNNEL_DAILY_QUOTA: z.coerce.number().int().positive().default(20_000),
  TRUSTED_PROXIES: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().optional(),
  ),
  MAX_WS_BUFFER_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  MAX_REPLAY_BACKLOG_BATCH: z.coerce.number().int().positive().default(50),
  // Encoded JSON budget per batch. A larger single package travels alone, without truncation.
  MAX_REPLAY_BATCH_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  // Deadline for receipt of a whole batch, independent of local-target execution time.
  RELAY_ACK_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // Server retention (see modules/retention): payloads of fully confirmed events, then metadata,
  // then audit rows.
  SERVER_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  SERVER_METADATA_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});

export type ServerEnv = Omit<z.infer<typeof ServerEnvSchema>, "PUBLIC_URL"> & {
  PUBLIC_URL: string;
};

/**
 * Parses and strictly validates server runtime environment variables using Zod.
 *
 * @param raw - Raw environment dictionary (defaults to process.env).
 * @returns Fully validated and defaulted ServerEnv object.
 */
export const parseEnv = (raw: Record<string, unknown> = process.env): ServerEnv => {
  // 1. Safe parse raw environment properties against schema
  const result = ServerEnvSchema.safeParse(raw);

  // 2. Fail startup without exposing configuration values or disabling authentication
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment configuration: ${fields}`);
  }

  // 3. A localhost default in production silently breaks auth origins and secure cookies.
  const { PUBLIC_URL, ...rest } = result.data;
  if (!PUBLIC_URL && rest.NODE_ENV === "production")
    throw new Error(
      "Invalid server environment configuration: PUBLIC_URL is required in production",
    );
  return { ...rest, PUBLIC_URL: PUBLIC_URL ?? `http://localhost:${rest.PORT}` };
};

export const env = parseEnv();

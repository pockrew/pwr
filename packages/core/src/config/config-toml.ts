import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord } from "@pockrew/pwr-shared/libs";
import {
  AgentUpdateModeSchema,
  DEFAULT_LOG_SETTINGS,
  LogSettingsSchema,
  type AgentUpdateMode,
  type LogSettings,
} from "@pockrew/pwr-shared/schemas";

import { DEFAULT_PROXY_CONFIG, type IProxyConfig } from "./proxy-resolver";

export interface IRetentionConfig {
  maxEvents: number;
  retentionDays: number;
  maxDbSizeMb: number;
  autoVacuum: boolean;
}

/** MCP tools that call local targets are opt-in: webhook bodies can carry prompt injection. */
export interface IMcpConfig {
  allowReplay: boolean;
}

/** Self-update of release binaries (see `AgentUpdateModeSchema`). */
export interface IUpdatesConfig {
  mode: AgentUpdateMode;
}

/** Agent settings in `~/.pockrew/config.toml`. Credentials never live here (see agent DB). */
export interface IPwrConfig {
  retention: IRetentionConfig;
  mcp: IMcpConfig;
  proxy: IProxyConfig;
  updates: IUpdatesConfig;
  /** Minimum level written to `logs/agent.log` and its rotation. */
  logs: LogSettings;
}

export const DEFAULT_CONFIG: IPwrConfig = {
  retention: {
    maxEvents: 1000,
    retentionDays: 7,
    maxDbSizeMb: 512,
    autoVacuum: true,
  },
  mcp: { allowReplay: false },
  proxy: DEFAULT_PROXY_CONFIG,
  updates: { mode: "manual" },
  logs: DEFAULT_LOG_SETTINGS,
};

const getPockrewDir = (): string => join(homedir(), ".pockrew");

/** Absolute path of the agent settings file. */
export const getTomlConfigPath = (): string => join(getPockrewDir(), "config.toml");

/**
 * Serializes the agent settings into TOML.
 * @param config - Settings to write.
 * @returns TOML text.
 */
export const formatConfigAsToml = (config: IPwrConfig): string => {
  const lines: string[] = [
    "[retention]",
    `max_events = ${config.retention.maxEvents}`,
    `retention_days = ${config.retention.retentionDays}`,
    `max_db_size_mb = ${config.retention.maxDbSizeMb}`,
    `auto_vacuum = ${config.retention.autoVacuum}`,
    "",
    "[mcp]",
    `allow_replay = ${config.mcp.allowReplay}`,
    "",
    "[proxy]",
    `mode = ${JSON.stringify(config.proxy.mode)}`,
    `no_proxy = ${JSON.stringify(config.proxy.noProxy)}`,
  ];
  if (config.proxy.httpProxy) lines.push(`http_proxy = ${JSON.stringify(config.proxy.httpProxy)}`);
  if (config.proxy.httpsProxy)
    lines.push(`https_proxy = ${JSON.stringify(config.proxy.httpsProxy)}`);
  if (config.proxy.caCertPath)
    lines.push(`ca_cert_path = ${JSON.stringify(config.proxy.caCertPath)}`);
  lines.push(
    "",
    "[updates]",
    `mode = ${JSON.stringify(config.updates.mode)}`,
    "",
    "[logs]",
    `level = ${JSON.stringify(config.logs.level)}`,
    `max_size_mb = ${config.logs.maxSizeMb}`,
    `max_files = ${config.logs.maxFiles}`,
    "",
  );
  return lines.join("\n");
};

/** Normalize the `[proxy]` table; unknown modes fall back to `auto`. */
const parseProxy = (raw: unknown): IProxyConfig => {
  if (!isRecord(raw)) return DEFAULT_CONFIG.proxy;
  const str = (key: string) => (typeof raw[key] === "string" ? raw[key] : undefined);
  return {
    mode: raw["mode"] === "manual" || raw["mode"] === "disabled" ? raw["mode"] : "auto",
    noProxy: str("no_proxy") ?? "localhost,127.0.0.1,::1",
    httpProxy: str("http_proxy"),
    httpsProxy: str("https_proxy"),
    caCertPath: str("ca_cert_path"),
  };
};

/** Normalize the `[logs]` table; an invalid table falls back to the defaults as a whole. */
const parseLogs = (raw: unknown): LogSettings => {
  if (!isRecord(raw)) return DEFAULT_LOG_SETTINGS;
  const parsed = LogSettingsSchema.safeParse({
    level: raw["level"] ?? DEFAULT_LOG_SETTINGS.level,
    maxSizeMb: raw["max_size_mb"] ?? DEFAULT_LOG_SETTINGS.maxSizeMb,
    maxFiles: raw["max_files"] ?? DEFAULT_LOG_SETTINGS.maxFiles,
  });
  return parsed.success ? parsed.data : DEFAULT_LOG_SETTINGS;
};

/** Normalize the `[retention]` table; missing or mistyped values use defaults. */
const parseRetention = (raw: unknown): IRetentionConfig => {
  if (!isRecord(raw)) return DEFAULT_CONFIG.retention;
  const num = (key: string, fallback: number) =>
    typeof raw[key] === "number" ? raw[key] : fallback;
  return {
    maxEvents: num("max_events", DEFAULT_CONFIG.retention.maxEvents),
    retentionDays: num("retention_days", DEFAULT_CONFIG.retention.retentionDays),
    maxDbSizeMb: num("max_db_size_mb", DEFAULT_CONFIG.retention.maxDbSizeMb),
    autoVacuum:
      typeof raw["auto_vacuum"] === "boolean"
        ? raw["auto_vacuum"]
        : DEFAULT_CONFIG.retention.autoVacuum,
  };
};

/**
 * Load `~/.pockrew/config.toml`; an absent or unparseable file yields the defaults.
 * @returns Complete settings object.
 */
export const loadTomlConfig = (): IPwrConfig => {
  const path = getTomlConfigPath();
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    const parsed: unknown = Bun.TOML.parse(readFileSync(path, "utf-8"));
    if (!isRecord(parsed)) return DEFAULT_CONFIG;
    return {
      retention: parseRetention(parsed["retention"]),
      mcp: { allowReplay: isRecord(parsed["mcp"]) && parsed["mcp"]["allow_replay"] === true },
      proxy: parseProxy(parsed["proxy"]),
      updates: {
        mode:
          AgentUpdateModeSchema.safeParse(isRecord(parsed["updates"]) && parsed["updates"]["mode"])
            .data ?? "manual",
      },
      logs: parseLogs(parsed["logs"]),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
};

/**
 * Atomically replace `~/.pockrew/config.toml` (0600 inside a 0700 directory).
 * @param config - Settings to serialize and write.
 * @throws On serialization or filesystem errors; callers must not report a successful save.
 */
export const saveTomlConfig = (config: IPwrConfig): void => {
  // 1. Validate serialization before replacing any settings; quote-bearing values must round-trip.
  const serialized = formatConfigAsToml(config);
  Bun.TOML.parse(serialized);
  const dir = getPockrewDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `.config-${crypto.randomUUID()}.tmp`);
  try {
    // 2. A failed write/rename must reach API callers and leave the previous file intact.
    writeFileSync(temporary, serialized, { encoding: "utf-8", mode: 0o600 });
    renameSync(temporary, getTomlConfigPath());
  } finally {
    rmSync(temporary, { force: true });
  }
};

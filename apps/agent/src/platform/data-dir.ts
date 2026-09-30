import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { agentDataDirPath, agentDbFilePath, agentFilePaths } from "@pockrew/pwr-core";

/** SQLite file holding config, queue, keys and secrets; tests point it at a temporary directory. */
export const agentDbFile: string = agentDbFilePath();

/** Directory owning every agent-private file (lock, token, instance ID, logs). */
export const agentDataDir: string = agentDataDirPath();

/** Paths of agent-private files; all are created 0600 inside a 0700 directory. */
export const agentFiles = agentFilePaths();

/** Create the private data directory; an existing directory is tightened to owner-only. */
export const ensureAgentDataDir = (): void => {
  mkdirSync(agentDataDir, { recursive: true, mode: 0o700 });
  chmodSync(agentDataDir, 0o700);
};

/**
 * Read a private random value, creating it on first use.
 * @param path - File inside the agent data directory.
 * @returns Trimmed hex string, stable across restarts; throws on permission/IO failure.
 */
export const readOrCreateSecretFile = (path: string): string => {
  ensureAgentDataDir();
  if (existsSync(path)) {
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
  }
  const value = randomBytes(32).toString("hex");
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return value;
};

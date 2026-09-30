import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Agent SQLite file; tests and custom installs override it with AGENT_DB_FILE_NAME. */
export const agentDbFilePath = (): string =>
  process.env["AGENT_DB_FILE_NAME"] ?? join(homedir(), ".pockrew", "agent.db");

/** Directory owning the agent's private files; shared by the agent daemon and the CLI. */
export const agentDataDirPath = (): string => {
  const db = agentDbFilePath();
  return db === ":memory:" ? join(homedir(), ".pockrew") : dirname(db);
};

/** Paths of the agent's private files (0600 inside a 0700 directory). */
export const agentFilePaths = () => {
  const dir = agentDataDirPath();
  return {
    lock: join(dir, "agent.lock"),
    token: join(dir, "agent.token"),
    /** Local API port the running agent bound, for the CLI when the default port was busy. */
    port: join(dir, "agent.port"),
    instanceId: join(dir, "agent.id"),
    logs: join(dir, "logs"),
    logFile: join(dir, "logs", "agent.log"),
    /** stdout/stderr of a background agent: runtime crash output only; logs go to `logFile`. */
    outputFile: join(dir, "logs", "agent.out.log"),
  };
};

/** Read the local API token for CLI/MCP clients; null before the agent first started. */
export const readAgentToken = (): string | null => {
  const path = agentFilePaths().token;
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
};

/** Port recorded by the agent after binding; null when absent or malformed. */
export const readRecordedAgentPort = (): number | null => {
  const path = agentFilePaths().port;
  if (!existsSync(path)) return null;
  const port = Number(readFileSync(path, "utf8").trim());
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
};

import { fstatSync } from "node:fs";

import { configureLogging, loadTomlConfig } from "@pockrew/pwr-core";
import type { LogSettings } from "@pockrew/pwr-shared/schemas";

import { agentFiles } from "./data-dir";

/**
 * A background agent's stdout is a regular file (agent.out.log, kept for crash output), so only a
 * foreground agent (terminal, development) gets a readable console copy of its log.
 */
const consoleCopy = (): "text" | false => {
  try {
    return fstatSync(1).isFile() ? false : "text";
  } catch {
    return false;
  }
};

/**
 * Write agent logs to the rotating JSON Lines file `logs/agent.log` that Studio reads.
 * @param settings - Level and rotation; defaults to `[logs]` in config.toml.
 */
export const applyAgentLogSettings = (
  settings: LogSettings = loadTomlConfig().logs,
): Promise<void> =>
  configureLogging(
    { category: ["pwr", "agent"], file: agentFiles.logFile, console: consoleCopy() },
    settings,
  );

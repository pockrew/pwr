// @server-only
import { dirname, join, resolve } from "node:path";

import { configureLogging } from "@pockrew/pwr-core";
import type { LogSettings } from "@pockrew/pwr-shared/schemas";

import { env } from "./env";

/** Rotating JSON Lines log read by Admin: `$LOG_DIR/server.log`, by default beside the database. */
export const serverLogFile = join(
  env.LOG_DIR ?? join(dirname(resolve(env.DB_FILE_NAME)), "logs"),
  "server.log",
);

/**
 * Log to the rotating file and, as JSON Lines, to stdout for container log collectors.
 * @param settings - Minimum level and rotation; saved from Admin.
 */
export const applyServerLogSettings = (settings: LogSettings): Promise<void> =>
  configureLogging({ category: ["pwr", "server"], file: serverLogFile, console: "json" }, settings);

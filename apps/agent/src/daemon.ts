import { getLogger } from "@logtape/logtape";

import { closeLogging } from "@pockrew/pwr-core";

import { app } from "./app";
import { localDb } from "./db/client";
import { tunnelManager } from "./modules/relays/service";
import { runRetention, startRetentionTimer } from "./modules/storage/retention.service";
import { startUpdateTimer } from "./modules/updates/service";
import { registerShutdown } from "./platform/lifecycle";
import { listenLocalApi } from "./platform/listen";
import { agentHostname } from "./platform/local-access";
import { agentToken } from "./platform/local-auth";

const logger = getLogger(["pwr", "agent", "daemon"]);

// 0. Create the local API token up front so the CLI, MCP clients and `pwr studio` can read it.
agentToken();

// 1. Bind the local API first: if no port can be bound, fail before touching relays or retention.
const server = listenLocalApi(app.fetch);

// 2. Startup cleanup; reporting must stay available even if it cannot reclaim enough space.
try {
  const result = runRetention();
  logger.info("Pruned {deletedPackages} confirmed results; intake {intake}", {
    deletedPackages: result.deletedPackages,
    intake: result.storage.state,
  });
} catch {
  logger.error("Startup cleanup failed; intake blocked and stored data retained");
}

// 3. Recover locally acknowledged work even when the server has no pending receipts left.
tunnelManager.restoreConnections();
const stopRetention = startRetentionTimer(tunnelManager.refreshIntake);

// 4. Daily release check; `auto` mode installs and restarts through the graceful path below.
const stopUpdateChecks = startUpdateTimer();

logger.info("Daemon active on {url}; MCP endpoint {url}/mcp", {
  url: `http://${agentHostname}:${server.port}`,
});

let isShuttingDown = false;

/**
 * Executes a graceful shutdown procedure for the agent daemon:
 * 1. Stops the local HTTP API and MCP server.
 * 2. Gracefully closes active tunnel WebSocket sessions to the relay server.
 * 3. Checkpoints and closes local SQLite database.
 * 4. Flushes and closes the log file.
 *
 * @param signal - OS termination signal (SIGINT or SIGTERM), or a local API stop/restart request.
 * @param exitCode - 0 to stay stopped; non-zero asks a service manager to relaunch the agent.
 */
export const gracefulShutdown = async (signal: string, exitCode = 0): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  stopRetention();
  stopUpdateChecks();
  logger.info("Received {signal}; starting graceful shutdown", { signal });

  // 1. Stop accepting local API requests; let in-flight ones finish, but long-lived event streams
  // are force-closed after 3s.
  try {
    await Promise.race([server.stop(), Bun.sleep(3_000).then(() => server.stop(true))]);
    logger.info("HTTP server stopped");
  } catch (error) {
    logger.error("Stopping the HTTP server failed: {error}", { error });
  }

  // 2. Disconnect active tunnel connections gracefully
  try {
    await tunnelManager.shutdown();
    logger.info("Relay sockets closed and in-flight results persisted");
  } catch (error) {
    logger.error("Disconnecting tunnels failed: {error}", { error });
  }

  // 3. Checkpoint SQLite WAL and close local database
  try {
    localDb.run("PRAGMA wal_checkpoint(TRUNCATE);");
    localDb.close();
    logger.info("Local SQLite checkpointed and closed");
  } catch (error) {
    logger.error("Closing the agent database failed: {error}", { error });
  }

  // 4. Flush buffered log records last, so the shutdown itself is in agent.log.
  logger.info("Graceful shutdown completed; exiting");
  await closeLogging();
  process.exit(exitCode);
};

registerShutdown(gracefulShutdown);
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));

export default server;

import { getLogger } from "@logtape/logtape";
import { sqliteClient } from "@server/db/client";
import { ensureAdminAccount } from "@server/modules/auth/bootstrap";
import { startIngressRecovery } from "@server/modules/ingress/events";
import { startServerRetention } from "@server/modules/retention/service";

import { closeLogging } from "@pockrew/pwr-core";

import { app, websocket } from "./app";
import { loadLogSettings } from "./modules/logs/service";
import { relayService } from "./modules/relays/service";
import { env } from "./platform/env";
import { applyServerLogSettings } from "./platform/logging";

// 0. Logging first; the database is migrated on import, so saved log settings are readable.
await applyServerLogSettings(loadLogSettings());
const logger = getLogger(["pwr", "server", "daemon"]);

await ensureAdminAccount();

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
  websocket: {
    ...websocket,
    // Agents only send small ACK frames (≤2 MiB after validation); reject oversized frames
    // before Bun buffers them.
    maxPayloadLength: 4 * 1024 * 1024,
    // A stalled agent that stops reading is closed; its PENDING deliveries resync on reconnect.
    backpressureLimit: 32 * 1024 * 1024,
    closeOnBackpressureLimit: true,
    idleTimeout: 120,
    sendPings: true,
  },
});
const stopIngressRecovery = startIngressRecovery();
const stopRetention = startServerRetention();

logger.info(
  "Engine running at {url}; ingress {url}/ingress/:slug/:collectionId; health {url}/api/health",
  {
    url: `http://localhost:${server.port}`,
  },
);

let isShuttingDown = false;

/**
 * Executes a graceful shutdown procedure for the server:
 * 1. Stops accepting new ingress HTTP connections.
 * 2. Stops delivery recovery and closes active relay WebSockets.
 * 3. Checkpoints and closes SQLite; stored events recover their deliveries at next startup.
 * 4. Flushes and closes the log file.
 *
 * @param signal - OS termination signal (SIGINT or SIGTERM).
 */
export const gracefulShutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  stopIngressRecovery();
  stopRetention();
  logger.info("Received {signal}; starting graceful shutdown", { signal });

  // 1. Close relay sockets first so their long-lived connections don't hold the drain open.
  try {
    relayService.closeAll("Server is shutting down");
    logger.info("Active WebSocket connections closed");
  } catch (error) {
    logger.error("Closing WebSocket connections failed: {error}", { error });
  }

  // 2. Stop accepting requests and let in-flight ingress finish (its event may already be
  // committed; dropping the connection would make the provider retry). Force after 10s.
  try {
    await Promise.race([server.stop(), Bun.sleep(10_000).then(() => server.stop(true))]);
    logger.info("HTTP server drained");
  } catch (error) {
    logger.error("Stopping the HTTP server failed: {error}", { error });
  }

  // 3. Checkpoint SQLite WAL and close database cleanly
  try {
    sqliteClient.run("PRAGMA wal_checkpoint(TRUNCATE);");
    sqliteClient.close();
    logger.info("SQLite WAL checkpointed and connection closed");
  } catch (error) {
    logger.error("Closing the database failed: {error}", { error });
  }

  // 4. Flush buffered log records last, so the shutdown itself is in server.log.
  logger.info("Graceful shutdown completed; exiting");
  await closeLogging();
  process.exit(0);
};

process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));

export default server;

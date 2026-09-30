import { getLogger } from "@logtape/logtape";

import { acquireInstanceLock, waitForReplacedAgent } from "./platform/instance-lock";
import { applyAgentLogSettings } from "./platform/logging";

// 1. After a restart request, let the agent being replaced release its lock, port and log file.
await waitForReplacedAgent();

// 2. LogTape next, so a lock failure also reaches logs/agent.log.
await applyAgentLogSettings();

// 3. Exclusive lock: the daemon module opens and migrates SQLite on import.
try {
  acquireInstanceLock();
} catch (error) {
  getLogger(["pwr", "agent", "daemon"]).fatal("{reason}", {
    reason: error instanceof Error ? error.message : "Lock failed",
  });
  process.exit(1);
}

// 4. Only the lock owner loads storage, binds the port and starts relays.
await import("./daemon");

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { agentFiles, ensureAgentDataDir } from "./data-dir";

/** Set on an agent started by a restart request: the PID of the agent it replaces. */
export const REPLACES_PID_ENV = "PWR_AGENT_REPLACES_PID";

/** True while a process with this PID exists (signal 0 only probes). */
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/**
 * Restart handoff: wait up to 30s for the agent this process replaces to release its lock and
 * port. If it is still alive afterwards, taking the lock fails as for any second agent.
 */
export const waitForReplacedAgent = async (): Promise<void> => {
  const pid = Number.parseInt(process.env[REPLACES_PID_ENV] ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) return;
  for (let waited = 0; waited < 30_000 && isAlive(pid); waited += 100) await Bun.sleep(100);
};

/**
 * Take the exclusive per-data-directory agent lock before opening SQLite, relay sockets or
 * retention. Two daemons on one DB would drain the same packages and call every target twice.
 * @returns Release function (also run on process exit); throws when another live agent holds it.
 */
export const acquireInstanceLock = (): (() => void) => {
  ensureAgentDataDir();
  // 1. O_EXCL create; on conflict, only a lock whose owner is gone may be replaced.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(agentFiles.lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      const release = (): void => {
        try {
          if (readFileSync(agentFiles.lock, "utf8").trim() === String(process.pid))
            unlinkSync(agentFiles.lock);
        } catch {
          // Already removed.
        }
      };
      process.once("exit", release);
      return release;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const owner = Number.parseInt(readFileSync(agentFiles.lock, "utf8").trim(), 10);
      if (Number.isInteger(owner) && owner !== process.pid && isAlive(owner))
        throw new Error(`Another pwr-agent (pid ${owner}) is already using ${agentFiles.lock}`);
      // 2. Stale lock from a crashed agent.
      unlinkSync(agentFiles.lock);
    }
  }
  throw new Error(`Could not acquire ${agentFiles.lock}`);
};

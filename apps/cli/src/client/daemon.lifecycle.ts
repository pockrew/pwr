import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { hc } from "hono/client";

import type { AgentAppType } from "@pockrew/pwr-agent/rpc";
import { agentFilePaths, readAgentToken, readRecordedAgentPort } from "@pockrew/pwr-core";
import type { AgentStorageStatus } from "@pockrew/pwr-shared/schemas";

/**
 * Health and uptime telemetry snapshot returned by the Agent daemon.
 */
export interface IAgentHealth {
  online: boolean;
  status?: "ok" | "storage_blocked" | undefined;
  version?: string | undefined;
  storage?: AgentStorageStatus | undefined;
  uptimeSeconds?: number | undefined;
  activeTunnelsCount?: number | undefined;
  totalTunnelsCount?: number | undefined;
}

/** Local API token header, read from the agent's owner-only token file on every request. */
export const agentAuthHeaders = (): Record<string, string> => {
  const token = readAgentToken();
  return token ? { authorization: `Bearer ${token}` } : {};
};

/** The agent's preferred port; it moves to a free port when this one is busy and none is pinned. */
export const DEFAULT_AGENT_PORT = 18788;

/** A port pinned with `--port` or PWR_AGENT_PORT; undefined lets the agent choose. */
export const pinnedAgentPort = (flag?: number): number | undefined => {
  if (flag !== undefined) return flag;
  const env = Number(process.env["PWR_AGENT_PORT"]);
  return Number.isInteger(env) && env > 0 && env < 65_536 ? env : undefined;
};

/**
 * Port of the local agent API: a pinned port, else the port the running agent recorded, else the
 * default. The record is trusted only while its agent still holds the data-directory lock.
 * @param flag - Value of `--port`, if given.
 */
export const agentPort = (flag?: number): number =>
  pinnedAgentPort(flag) ??
  (agentDaemonPid() === null ? null : readRecordedAgentPort()) ??
  DEFAULT_AGENT_PORT;

/**
 * Probes the local Agent daemon HTTP endpoint to determine health, uptime, and tunnel count.
 *
 * @param port - Pinned `--port`; omitted, the running agent's port is discovered.
 * @returns Health metrics object indicating online state and active tunnels.
 */
export const checkAgentHealth = async (port?: number): Promise<IAgentHealth> => {
  const client = hc<AgentAppType>(`http://127.0.0.1:${agentPort(port)}`);

  try {
    const res = await client.health.$get({}, { init: { signal: AbortSignal.timeout(600) } });

    if (res.ok) {
      const { data } = await res.json();
      return {
        online: true,
        status: data.status === "ok" || data.status === "storage_blocked" ? data.status : undefined,
        version: data.version,
        storage: data.storage,
        uptimeSeconds: data.uptimeSeconds,
        activeTunnelsCount: data.activeTunnelsCount,
        totalTunnelsCount: data.totalTunnelsCount,
      };
    }
  } catch {
    // Daemon unreachable or connection refused
  }

  return { online: false };
};

/** Resolve a source Agent relative to this module, or the binary shipped beside compiled CLI. */
export const resolveAgentCommand = (): string[] => {
  const binaryName = process.platform === "win32" ? "pwr-agent.exe" : "pwr-agent";
  const siblingAgent = resolve(dirname(process.execPath), binaryName);
  if (existsSync(siblingAgent)) return [siblingAgent];
  const devAgentEntry = resolve(import.meta.dir, "../../../agent/src/index.ts");
  if (basename(process.execPath).startsWith("bun") && existsSync(devAgentEntry))
    return [process.execPath, devAgentEntry];
  return [binaryName];
};

/**
 * Start the agent as a detached background process that survives this CLI (and Ctrl+C). The agent
 * writes its own rotating log; stdout/stderr go to the output file for crash output only.
 * @param port - Pinned `--port`; omitted, the agent prefers the default and falls back to a free port.
 * @returns True once the daemon answers its health probe (up to ~5s).
 */
export const startAgentDaemon = async (port?: number): Promise<boolean> => {
  const files = agentFilePaths();
  mkdirSync(files.logs, { recursive: true, mode: 0o700 });
  const log = openSync(files.outputFile, "a", 0o600);
  try {
    const [command, ...args] = resolveAgentCommand();
    if (!command) return false;
    const pinned = pinnedAgentPort(port);
    const child = spawn(command, args, {
      env: pinned === undefined ? process.env : { ...process.env, PWR_AGENT_PORT: String(pinned) },
      detached: true,
      // Without this a detached child opens its own console window on Windows.
      windowsHide: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
  } catch {
    return false;
  } finally {
    closeSync(log);
  }
  for (let i = 0; i < 50; i += 1) {
    await Bun.sleep(100);
    if ((await checkAgentHealth(port)).online) return true;
  }
  return false;
};

/**
 * Ensures the agent daemon is active, starting it in the background if offline. Used by commands
 * that act (connect, replay, config edits); read-only commands report "not running" instead.
 * @param port - Pinned `--port`; omitted, the running agent's port is discovered.
 * @returns True if the daemon is online and responsive; then `agentPort(port)` is its port.
 */
export const ensureAgentDaemonRunning = async (port?: number): Promise<boolean> =>
  (await checkAgentHealth(port)).online || startAgentDaemon(port);

/** PID recorded in the agent's exclusive lock file, or null when no agent holds it. */
export const agentDaemonPid = (): number | null => {
  const lock = agentFilePaths().lock;
  if (!existsSync(lock)) return null;
  const pid = Number.parseInt(readFileSync(lock, "utf8").trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
};

/**
 * Start the agent's graceful shutdown. SIGTERM on macOS/Linux; Windows has no SIGTERM (a signal
 * terminates the process at once), so it asks the local API instead. Only when the API does not
 * answer is the process killed; the agent commits before every ACK, so stored work resumes on
 * the next start.
 */
const requestStop = async (pid: number): Promise<void> => {
  if (process.platform !== "win32") {
    process.kill(pid, "SIGTERM");
    return;
  }
  const client = hc<AgentAppType>(`http://127.0.0.1:${agentPort()}`, {
    headers: agentAuthHeaders,
  });
  const response = await client.agent.stop
    .$post({}, { init: { signal: AbortSignal.timeout(5_000) } })
    .catch(() => null);
  if (response?.ok) return;
  try {
    process.kill(pid);
  } catch {
    // Already exited while the request was pending.
  }
};

/**
 * Ask the running agent to shut down gracefully and wait for it to exit, so in-flight target
 * calls commit their results first.
 * @returns "stopped", "not_running", or "timeout" if it is still alive after 15s.
 */
export const stopAgentDaemon = async (): Promise<"stopped" | "not_running" | "timeout"> => {
  const pid = agentDaemonPid();
  if (pid === null) return "not_running";
  await requestStop(pid);
  for (let i = 0; i < 150; i += 1) {
    await Bun.sleep(100);
    if (agentDaemonPid() === null) return "stopped";
  }
  return "timeout";
};

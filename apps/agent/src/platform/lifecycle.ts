import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { basename } from "node:path";

import { agentFiles } from "./data-dir";
import { REPLACES_PID_ENV } from "./instance-lock";

/** Stop ends the daemon; restart also brings a new one up on the same data directory and port. */
export type LifecycleAction = "stop" | "restart";

/** Graceful shutdown owned by the daemon; exits the process with `exitCode` when done. */
type ShutdownHandler = (reason: string, exitCode: number) => Promise<void>;

/**
 * Non-zero exit that makes launchd (`KeepAlive.SuccessfulExit=false`) and systemd
 * (`Restart=on-failure`) relaunch an agent installed by `pwr agent install-service`.
 */
const RELAUNCH_EXIT_CODE = 75;

let shutdownHandler: ShutdownHandler | undefined;

/** Called once by the daemon so the local API can stop the process it runs in. */
export const registerShutdown = (handler: ShutdownHandler): void => {
  shutdownHandler = handler;
};

/** A source run needs Bun plus the entry file; a compiled `pwr-agent` binary is its own command. */
const selfArgs = (): string[] => (basename(process.execPath).startsWith("bun") ? [Bun.main] : []);

/**
 * Start a detached copy of this agent that waits for this PID to exit before taking the lock and
 * port. Its stdout/stderr go to the output file, as with `pwr agent start`.
 * @returns Once the process exists; rejects when it could not be started.
 */
const spawnReplacement = async (): Promise<void> => {
  mkdirSync(agentFiles.logs, { recursive: true, mode: 0o700 });
  const log = openSync(agentFiles.outputFile, "a", 0o600);
  try {
    const child = spawn(process.execPath, selfArgs(), {
      env: { ...process.env, [REPLACES_PID_ENV]: String(process.pid) },
      detached: true,
      stdio: ["ignore", log, log],
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  } finally {
    closeSync(log);
  }
};

/**
 * Stop or restart this agent from the local API.
 * 1. An unsupervised restart starts its replacement first; if that fails, this agent keeps running.
 * 2. Shutdown runs after the response is sent, on the same graceful path as SIGTERM, so in-flight
 *    target results commit before exit. Under launchd/systemd, restart exits non-zero instead and
 *    the service manager relaunches the agent.
 * @param action - Requested lifecycle change.
 */
export const requestLifecycle = async (
  action: LifecycleAction,
): Promise<{ action: LifecycleAction }> => {
  const shutdown = shutdownHandler;
  if (!shutdown) throw new Error("The daemon has not registered its shutdown");
  const supervised = process.env["PWR_AGENT_SUPERVISED"] === "1";
  if (action === "restart" && !supervised) await spawnReplacement();
  const exitCode = action === "restart" && supervised ? RELAUNCH_EXIT_CODE : 0;
  setTimeout(() => void shutdown(`${action} request`, exitCode), 0);
  return { action };
};

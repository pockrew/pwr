import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";

import { agentFilePaths } from "@pockrew/pwr-core";

import { agentPort, DEFAULT_AGENT_PORT } from "./daemon.lifecycle";

const files = agentFilePaths();
const record = (port: number, lockPid: number | null) => {
  mkdirSync(files.logs, { recursive: true });
  writeFileSync(files.port, `${port}\n`);
  if (lockPid === null) rmSync(files.lock, { force: true });
  else writeFileSync(files.lock, `${lockPid}\n`);
};
afterEach(() => {
  delete process.env["PWR_AGENT_PORT"];
  rmSync(files.port, { force: true });
  rmSync(files.lock, { force: true });
});

test("the agent port is pinned, then recorded by the running agent, then the default", () => {
  expect(agentPort()).toBe(DEFAULT_AGENT_PORT);
  // 1. A record left by an agent that no longer holds the lock is ignored.
  record(40_123, null);
  expect(agentPort()).toBe(DEFAULT_AGENT_PORT);
  // 2. The running agent's record wins over the default...
  record(40_123, process.pid);
  expect(agentPort()).toBe(40_123);
  // 3. ...but never over a port pinned by PWR_AGENT_PORT or --port.
  process.env["PWR_AGENT_PORT"] = "40200";
  expect(agentPort()).toBe(40_200);
  expect(agentPort(40_300)).toBe(40_300);
});

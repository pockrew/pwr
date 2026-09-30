import { afterEach, expect, mock, test } from "bun:test";
import { app } from "@agent/app";

import { registerShutdown } from "./lifecycle";

const shutdown = mock(async (_reason: string, _exitCode: number) => {});
registerShutdown(shutdown);

const post = (path: string) => app.request(path, { method: "POST" });

afterEach(() => {
  shutdown.mockClear();
  delete process.env["PWR_AGENT_SUPERVISED"];
  delete process.env["PWR_AGENT_AUTH"];
});

test("stop answers first, then shuts down gracefully and stays stopped", async () => {
  const response = await post("/api/agent/stop");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { action: "stop" } });
  expect(shutdown).not.toHaveBeenCalled();
  await Bun.sleep(20);
  expect(shutdown).toHaveBeenCalledWith("stop request", 0);
});

test("a supervised restart exits non-zero so launchd/systemd relaunches the agent", async () => {
  process.env["PWR_AGENT_SUPERVISED"] = "1";
  expect((await post("/agent/restart")).status).toBe(200);
  await Bun.sleep(20);
  expect(shutdown).toHaveBeenCalledWith("restart request", 75);
});

test("lifecycle routes require the local token", async () => {
  process.env["PWR_AGENT_AUTH"] = "on";
  expect((await post("/agent/stop")).status).toBe(401);
  expect((await post("/api/agent/restart")).status).toBe(401);
  await Bun.sleep(20);
  expect(shutdown).not.toHaveBeenCalled();
});

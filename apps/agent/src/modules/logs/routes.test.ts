import { app } from "@agent/app";
import { reset } from "@logtape/logtape";
import { afterAll, expect, test } from "bun:test";

import { loadTomlConfig } from "@pockrew/pwr-core";
import type { LogPage, LogSettings } from "@pockrew/pwr-shared/schemas";

const json = async <T>(response: Response) => ((await response.json()) as { data: T }).data;
const put = (body: unknown) =>
  app.request("/logs/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Saving settings configures LogTape for this process; later test files expect it unconfigured.
afterAll(() => reset());

test("pages agent.log and validates its query", async () => {
  const page = await json<LogPage>(await app.request("/logs?level=warning"));
  expect(page.logFile).toEndWith("agent.log");
  expect((await app.request("/logs?limit=0")).status).toBe(400);
  expect((await app.request("/logs?before=not-a-cursor")).status).toBe(400);
});

test("log settings are validated, saved to config.toml and applied", async () => {
  const settings: LogSettings = { level: "warning", maxSizeMb: 3, maxFiles: 4 };
  expect(await json<LogSettings>(await put(settings))).toEqual(settings);
  expect(loadTomlConfig().logs).toEqual(settings);
  expect((await put({ ...settings, level: "loud" })).status).toBe(400);
  expect(await json<LogSettings>(await app.request("/logs/settings"))).toEqual(settings);
});

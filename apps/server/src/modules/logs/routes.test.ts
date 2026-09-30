import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { reset } from "@logtape/logtape";
import { afterAll, beforeAll, expect, test } from "bun:test";

import type { LogPage, LogSettings } from "@pockrew/pwr-shared/schemas";

process.env["BETTER_AUTH_SECRET"] = "server-logs-test-secret-at-least-32-characters";
process.env["ADMIN_EMAIL"] = "logs-test@example.com";
process.env["ADMIN_PASSWORD"] = "logs-test-password";
const { app } = await import("@server/app");
const { ensureAdminAccount } = await import("@server/modules/auth/bootstrap");
const { auth } = await import("@server/modules/auth/configs");
const { env } = await import("@server/platform/env");
const { serverLogFile } = await import("@server/platform/logging");

let cookie = "";
const record = (level: string, message: string, properties: Record<string, unknown>) =>
  `${JSON.stringify({ "@timestamp": new Date().toISOString(), level, message, logger: "pwr.server.http", properties })}\n`;

beforeAll(async () => {
  await ensureAdminAccount();
  const login = await auth.api.signInEmail({
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD ?? "" },
    asResponse: true,
  });
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  mkdirSync(dirname(serverLogFile), { recursive: true });
  writeFileSync(
    serverLogFile,
    record("INFO", "GET /api/health 200 1ms", { requestId: "req-1" }) +
      record("WARN", "request.ip_forbidden", { requestId: "req-2", clientIp: "203.0.113.9" }),
  );
});

// Saving settings configures LogTape for this process; later test files expect it unconfigured.
afterAll(() => reset());

test("only the admin session can read the server log", async () => {
  expect((await app.request("/api/logs")).status).toBe(403);
  expect((await app.request("/api/logs", { headers: { "x-api-key": "relay-key" } })).status).toBe(
    403,
  );
  const response = await app.request("/api/logs?level=warning&q=req-2", { headers: { cookie } });
  expect(response.status).toBe(200);
  const { data } = (await response.json()) as { data: LogPage };
  expect(data.entries.map((entry) => entry.message)).toEqual(["request.ip_forbidden"]);
  expect(data.entries[0]?.properties).toMatchObject({ requestId: "req-2" });
});

test("log settings are validated, saved and read back", async () => {
  const put = (body: unknown) =>
    app.request("/api/logs/settings", {
      method: "PUT",
      headers: {
        cookie,
        origin: new URL(env.PUBLIC_URL).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const settings: LogSettings = { level: "debug", maxSizeMb: 2, maxFiles: 3 };
  expect((await put(settings)).status).toBe(200);
  expect((await put({ ...settings, maxFiles: 0 })).status).toBe(400);
  const saved = await app.request("/api/logs/settings", { headers: { cookie } });
  expect(((await saved.json()) as { data: LogSettings }).data).toEqual(settings);
});

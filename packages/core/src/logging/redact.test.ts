import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLogger } from "@logtape/logtape";
import { afterEach, expect, test } from "bun:test";

import { redactLogValue } from "./redact";
import { closeLogging, configureLogging } from "./setup";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("masks credentials, sessions, signatures and webhook bodies at any depth", () => {
  expect(
    redactLogValue({
      "x-api-key": "k",
      relayKey: "k",
      headers: { Authorization: "Bearer t", cookie: "c", "x-hub-signature-256": "s" },
      endpoint: { targetSecret: "s", path: "/hooks" },
      payloadBase64: "AAAA",
      body: "raw",
      keyName: "payments",
      tunnelId: "t-1",
    }),
  ).toEqual({
    "x-api-key": "[REDACTED]",
    relayKey: "[REDACTED]",
    headers: {
      Authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "x-hub-signature-256": "[REDACTED]",
    },
    endpoint: { targetSecret: "[REDACTED]", path: "/hooks" },
    payloadBase64: "[REDACTED]",
    body: "[REDACTED]",
    keyName: "payments",
    tunnelId: "t-1",
  });
});

test("errors keep only name and code; unserializable values become safe", () => {
  const error = Object.assign(new Error("Failed query: insert … params: secret-payload"), {
    code: "SQLITE_CONSTRAINT",
  });
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  expect(redactLogValue({ error, big: 10n, at: new Date(0) })).toEqual({
    error: { name: "Error", code: "SQLITE_CONSTRAINT" },
    big: "10",
    at: "1970-01-01T00:00:00.000Z",
  });
  expect(JSON.stringify(redactLogValue(cyclic))).toContain("[deep]");
});

test("the log file never receives masked values, including message placeholders", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pwr-redact-"));
  dirs.push(dir);
  const file = join(dir, "test.log");
  await configureLogging(
    { category: ["pwr", "test"], file, console: false },
    { level: "debug", maxSizeMb: 1, maxFiles: 1 },
  );
  getLogger(["pwr", "test"]).error("Rejected {token} after {error}", {
    token: "leaked-token",
    error: new Error("params: leaked-payload"),
    apiKey: "leaked-key",
  });
  await closeLogging();
  const written = readFileSync(file, "utf8");
  expect(written).toContain("Rejected [REDACTED] after");
  expect(written).not.toContain("leaked");
});

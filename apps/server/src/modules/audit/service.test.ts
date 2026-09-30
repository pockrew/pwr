import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeLogging, configureLogging, parseLogLine } from "@pockrew/pwr-core";

process.env["BETTER_AUTH_SECRET"] = "audit-mirror-test-secret-at-least-32-characters";
process.env["ADMIN_EMAIL"] = "audit-mirror@example.com";
const { db } = await import("@server/db/client");
const { audit_logs } = await import("@server/db/schemas");
const { recordAudit } = await import("./service");

const dir = mkdtempSync(join(tmpdir(), "pwr-audit-log-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("an audit row is stored, then mirrored to the server log in the shared format", async () => {
  const file = join(dir, "server.log");
  await configureLogging(
    { category: ["pwr", "server"], file, console: false },
    { level: "info", maxSizeMb: 1, maxFiles: 1 },
  );
  const id = crypto.randomUUID();
  recordAudit({
    id,
    action: "ingress.hmac_failed",
    entityType: "tunnel",
    entityId: "t-1",
    details: JSON.stringify({ provider: "github", sourceIp: "203.0.113.9", requestId: "req-7" }),
  });
  await closeLogging();
  expect(
    db
      .select()
      .from(audit_logs)
      .all()
      .map((row) => row.id),
  ).toContain(id);
  const entry = parseLogLine("0:0", readFileSync(file, "utf8").trim());
  expect(entry).toMatchObject({
    category: "pwr.server.audit",
    message: "ingress.hmac_failed tunnel t-1",
    properties: {
      auditId: id,
      details: { provider: "github", sourceIp: "203.0.113.9", requestId: "req-7" },
    },
  });
});

test("audit pages continue by cursor without gaps or repeats", async () => {
  const { listAudits } = await import("./repository");
  for (let i = 0; i < 5; i += 1)
    recordAudit({
      id: crypto.randomUUID(),
      action: "ingress.hmac_failed",
      entityType: "tunnel",
      entityId: "paged",
      details: JSON.stringify({ tunnelId: "paged" }),
    });
  const first = listAudits(2, "paged");
  expect(first).toHaveLength(3);
  const second = listAudits(2, "paged", first[1]?.id);
  const third = listAudits(2, "paged", second[1]?.id);
  const ids = [...first.slice(0, 2), ...second.slice(0, 2), ...third].map((row) => row.id);
  expect(new Set(ids).size).toBe(5);
  expect(third).toHaveLength(1);
});

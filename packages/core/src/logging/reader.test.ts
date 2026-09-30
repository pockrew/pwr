import {
  appendFileSync,
  mkdtempSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";

import { formatLogEntry } from "./entry";
import { readLogPage, readLogTail } from "./reader";

let dir: string;
let path: string;
const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));
const LEVEL = { debug: "DEBUG", info: "INFO", warning: "WARN", error: "ERROR" } as const;

/** A line as LogTape's JSON Lines formatter writes it. */
const line = (
  level: keyof typeof LEVEL,
  message: string,
  time: Date,
  properties: Record<string, unknown> = {},
) =>
  `${JSON.stringify({ "@timestamp": time.toISOString(), level: LEVEL[level], message, logger: "pwr.agent.test", properties })}\n`;

const page = (query: Partial<Parameters<typeof readLogPage>[1]> = {}) =>
  readLogPage(path, { limit: 200, ...query });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pwr-logs-"));
  path = join(dir, "agent.log");
  writeFileSync(
    path,
    [
      "[pwr-agent] plain-text line from an older agent\n",
      line("info", "Daemon active", at(0)),
      line("warning", "Reconnecting ünïcode", at(10), { requestId: "req-42" }),
      line("error", "Retention failed\nError: disk", at(20)),
      line("debug", "plain debug", at(30)),
    ].join(""),
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("pages newest first and parses LogTape records and raw lines", async () => {
  const result = await page();
  expect(result.exists).toBe(true);
  expect(result.nextCursor).toBeNull();
  expect(result.entries.map((entry) => entry.level)).toEqual([
    "debug",
    "error",
    "warning",
    "info",
    "info",
  ]);
  const [, failure, warning, , legacy] = result.entries;
  expect(failure).toMatchObject({
    category: "pwr.agent.test",
    timestamp: at(20).toISOString(),
    message: "Retention failed\nError: disk",
  });
  expect(warning?.properties).toEqual({ requestId: "req-42" });
  expect(legacy).toMatchObject({ timestamp: null, category: null });
  expect(formatLogEntry(legacy ?? failure!)).toContain("plain-text line");
});

test("cursors continue without gaps or duplicates", async () => {
  const first = await page({ limit: 2 });
  const second = await page({ limit: 2, before: first.nextCursor ?? undefined });
  const third = await page({ limit: 2, before: second.nextCursor ?? undefined });
  const ids = [...first.entries, ...second.entries, ...third.entries].map((entry) => entry.id);
  expect(new Set(ids).size).toBe(5);
  expect(third.nextCursor).toBeNull();
});

test("filters by minimum level, text in properties, and date range", async () => {
  expect((await page({ level: "warning" })).entries.map((entry) => entry.level)).toEqual([
    "error",
    "warning",
  ]);
  expect((await page({ q: "REQ-42" })).entries).toHaveLength(1);
  expect((await page({ q: "ÜNÏCODE" })).entries).toHaveLength(1);
  const range = await page({ from: at(5).toISOString(), to: at(25).toISOString() });
  expect(range.entries.map((entry) => entry.message)).toEqual([
    "Retention failed\nError: disk",
    "Reconnecting ünïcode",
  ]);
  expect(range.nextCursor).toBeNull();
});

test("pages and date ranges continue into rotated files", async () => {
  renameSync(path, `${path}.1`);
  writeFileSync(path, line("info", "after rotation", at(40)));
  const result = await page({ limit: 3 });
  expect(result.entries.map((entry) => entry.message)).toEqual([
    "after rotation",
    "plain debug",
    "Retention failed\nError: disk",
  ]);
  const older = await page({ limit: 10, before: result.nextCursor ?? undefined });
  expect(older.entries).toHaveLength(3);
  expect(older.nextCursor).toBeNull();
  const range = await page({ to: at(15).toISOString() });
  expect(range.entries.map((entry) => entry.message)).toEqual([
    "Reconnecting ünïcode",
    "Daemon active",
    expect.stringContaining("plain-text"),
  ]);
});

test("the live tail resumes from its cursor and follows a rotation", async () => {
  const { tailCursor } = await page();
  expect((await readLogTail(path, tailCursor)).entries).toEqual([]);
  appendFileSync(path, line("info", "Connected", at(40)));
  appendFileSync(path, "partial line without newline");
  const tail = await readLogTail(path, tailCursor);
  expect(tail.entries.map((entry) => entry.message)).toEqual(["Connected"]);
  // The partial line completes, then LogTape rotates and starts a new file.
  appendFileSync(path, "\n");
  renameSync(path, `${path}.1`);
  writeFileSync(path, line("info", "new file", at(50)));
  const finished = await readLogTail(path, tail.next);
  expect(finished.entries.map((entry) => entry.message)).toEqual(["partial line without newline"]);
  expect((await readLogTail(path, finished.next)).entries.map((entry) => entry.message)).toEqual([
    "new file",
  ]);
  truncateSync(path, 5);
  const { next } = await readLogTail(path, finished.next);
  expect((await readLogTail(path, `${next.split(":")[0]}:999`)).reset).toBe(true);
});

test("a missing file is reported instead of failing", async () => {
  rmSync(path);
  expect(await page()).toMatchObject({ entries: [], exists: false, tailCursor: "0:0" });
});

test("a date range on a multi-megabyte file starts at the right entry", async () => {
  const start = Date.UTC(2026, 8, 1);
  const lines = Array.from({ length: 40_000 }, (_, i) =>
    line("info", `entry ${i} ${"x".repeat(60)}`, new Date(start + i * 1000)),
  );
  writeFileSync(path, lines.join(""));
  const second = (i: number) => new Date(start + i * 1000).toISOString();
  const result = await page({ from: second(30_000), to: second(30_049), limit: 500 });
  expect(result.entries).toHaveLength(50);
  expect(result.entries[0]?.message).toStartWith("entry 30049 ");
  expect(result.entries.at(-1)?.message).toStartWith("entry 30000 ");
  expect(result.nextCursor).toBeNull();
});

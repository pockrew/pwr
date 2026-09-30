import { mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

// Server tests never open the development database; agent tests never use the user's cache/config.
process.env["DB_FILE_NAME"] = ":memory:";
process.env["NODE_ENV"] = "test";
process.env["STRICT_AUTH"] = "false";
process.env["WEBHOOK_SIGNING_ENCRYPTION_KEY"] = "01".repeat(32);
delete process.env["MASTER_API_KEY"];
delete process.env["PWR_AGENT_HOST"];
delete process.env["PWR_AGENT_PORT"];
const testHome = mkdtempSync(join(os.tmpdir(), "pwr-tests-"));
process.env["LOG_DIR"] = join(testHome, "server-logs");
process.env["AGENT_DB_FILE_NAME"] = join(testHome, ".pockrew", "agent.db");
mock.module("node:os", () => ({ ...os, homedir: () => testHome }));
process.once("exit", () => rmSync(testHome, { recursive: true, force: true }));

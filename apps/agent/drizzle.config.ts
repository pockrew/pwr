import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/db/migrations",
  schema: "./src/db/schemas/index.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env["AGENT_DB_FILE_NAME"] ?? join(homedir(), ".pockrew", "agent.db"),
  },
});

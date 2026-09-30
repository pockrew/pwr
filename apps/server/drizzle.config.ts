import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit migration and schema configuration.
 * Seeding configuration is managed separately in `./src/db/seed.config.ts`
 * and executed via `bun run db:seed`.
 */
export default defineConfig({
  out: "./src/db/migrations",
  schema: "./src/db/schemas/index.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env["DB_FILE_NAME"] ?? "../data/pwr-db.sqlite",
  },
});

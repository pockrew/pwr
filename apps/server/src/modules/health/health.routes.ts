import { health } from "@server/db/client";
import { databaseUnavailableError } from "@server/platform/error.handlers";
import type { AppEnv } from "@server/platform/types";
import { Hono } from "hono";

export const healthRoutes = new Hono<AppEnv>()
  .get("/health", (c) => {
    return c.json(
      { data: { status: "healthy", timestamp: Date.now() }, requestId: c.get("requestId") },
      200,
    );
  })
  .get("/ready", async (c) => {
    if (await health()) {
      return c.json(
        {
          data: { status: "ready", database: "connected", timestamp: Date.now() },
          requestId: c.get("requestId"),
        },
        200,
      );
    }

    throw databaseUnavailableError("Database is disconnected");
  });

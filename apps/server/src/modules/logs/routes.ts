import { adminGuard } from "@server/modules/auth/guard";
import { requestIdOf } from "@server/platform/error.handlers";
import { serverLogFile } from "@server/platform/logging";
import type { AppEnv } from "@server/platform/types";
import {
  requireBodyValidation,
  requireQueryValidation,
} from "@server/platform/validator.middleware";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { followLog, readLogPage } from "@pockrew/pwr-core";
import {
  LogPageQuerySchema,
  LogSettingsSchema,
  LogStreamQuerySchema,
} from "@pockrew/pwr-shared/schemas";

import { loadLogSettings, saveLogSettings } from "./service";

/**
 * Server log for the admin account only (relay and CLI keys are refused): newest-first pages
 * across rotated files, a live SSE tail, and level/rotation settings.
 */
export const logRoutes = new Hono<AppEnv>()
  .use("*", adminGuard({ sessionOnly: true }))
  .get("/", requireQueryValidation(LogPageQuerySchema), async (c) =>
    c.json({
      data: await readLogPage(serverLogFile, c.req.valid("query")),
      requestId: requestIdOf(c),
    }),
  )
  .get("/stream", requireQueryValidation(LogStreamQuerySchema), (c) => {
    const { after, ...filter } = c.req.valid("query");
    return streamSSE(c, (stream) =>
      followLog(serverLogFile, after, filter, {
        send: (event, data) => stream.writeSSE({ event, data }),
        sleep: (ms) => stream.sleep(ms),
        isClosed: () => stream.aborted,
      }),
    );
  })
  .get("/settings", (c) => c.json({ data: loadLogSettings(), requestId: requestIdOf(c) }))
  .put("/settings", requireBodyValidation(LogSettingsSchema), async (c) =>
    c.json({ data: await saveLogSettings(c.req.valid("json")), requestId: requestIdOf(c) }),
  );

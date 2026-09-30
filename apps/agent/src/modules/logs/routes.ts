import { agentFiles } from "@agent/platform/data-dir";
import { sendData } from "@agent/platform/error.handlers";
import { applyAgentLogSettings } from "@agent/platform/logging";
import { requireValidation } from "@agent/platform/validator.middleware";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { followLog, loadTomlConfig, readLogPage, saveTomlConfig } from "@pockrew/pwr-core";
import {
  LogPageQuerySchema,
  LogSettingsSchema,
  LogStreamQuerySchema,
} from "@pockrew/pwr-shared/schemas";

/** agent.log pages (newest first, across rotated files), a live SSE tail, and rotation settings. */
export const logRoutes = new Hono()
  .get("/logs", requireValidation("query", LogPageQuerySchema), async (c) =>
    sendData(c, await readLogPage(agentFiles.logFile, c.req.valid("query"))),
  )
  .get("/logs/stream", requireValidation("query", LogStreamQuerySchema), (c) => {
    const { after, ...filter } = c.req.valid("query");
    return streamSSE(c, (stream) =>
      followLog(agentFiles.logFile, after, filter, {
        send: (event, data) => stream.writeSSE({ event, data }),
        sleep: (ms) => stream.sleep(ms),
        isClosed: () => stream.aborted,
      }),
    );
  })
  .get("/logs/settings", (c) => sendData(c, loadTomlConfig().logs))
  .put("/logs/settings", requireValidation("json", LogSettingsSchema), async (c) => {
    const logs = c.req.valid("json");
    // Saved first: a settings file that cannot be written must not leave a reconfigured logger.
    saveTomlConfig({ ...loadTomlConfig(), logs });
    await applyAgentLogSettings(logs);
    return sendData(c, logs);
  });

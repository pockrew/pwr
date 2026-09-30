import { tunnelManager } from "@agent/modules/relays/service";
import { sendData } from "@agent/platform/error.handlers";
import { requireValidation } from "@agent/platform/validator.middleware";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { loadTomlConfig, saveTomlConfig, validateMaintenanceRequest } from "@pockrew/pwr-core";
import { AgentCleanRequestSchema, RetentionConfigSchema } from "@pockrew/pwr-shared/schemas";

import { getStorageStatus, runRetention } from "./retention.service";

/** Every cleanup uses the same confirmed-result policy; capacity never permits forced deletion. */
export const storageRoutes = new Hono()
  .get("/retention", (c) =>
    sendData(c, {
      config: loadTomlConfig().retention,
      capabilities: { relayHistoryPruning: true, hardSizeLimit: false, intakeBackpressure: true },
      storage: getStorageStatus(),
    }),
  )
  .put("/retention", requireValidation("json", RetentionConfigSchema), (c) => {
    const config = { ...loadTomlConfig(), retention: c.req.valid("json") };
    saveTomlConfig(config);
    const result = runRetention();
    tunnelManager.refreshIntake();
    return sendData(c, {
      config: config.retention,
      capabilities: { relayHistoryPruning: true, hardSizeLimit: false, intakeBackpressure: true },
      storage: result.storage,
    });
  })
  .post("/maintenance/clean", requireValidation("json", AgentCleanRequestSchema), (c) => {
    const input = c.req.valid("json");
    const validation = validateMaintenanceRequest(input);
    if (!validation.valid) throw new HTTPException(400);
    const start = performance.now();
    const result = runRetention({
      days: input.days,
      projects: input.all ? undefined : input.projects,
    });
    tunnelManager.refreshIntake();
    return sendData(c, {
      action: "clean",
      affectedProjects: input.all ? ["*"] : (input.projects ?? ["*"]),
      processedCount: result.deletedPackages,
      deletedCount: result.deletedEvents,
      deletedPackages: result.deletedPackages,
      storage: result.storage,
      durationMs: performance.now() - start,
    });
  });

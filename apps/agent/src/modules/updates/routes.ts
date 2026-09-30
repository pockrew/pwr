import { sendData } from "@agent/platform/error.handlers";
import { requireValidation } from "@agent/platform/validator.middleware";
import { Hono } from "hono";

import { loadTomlConfig, saveTomlConfig } from "@pockrew/pwr-core";
import { AgentUpdateConfigSchema } from "@pockrew/pwr-shared/schemas";

import { checkForUpdate, startUpdate, updateStatus } from "./service";

/** Self-update of release binaries (agent with embedded Studio, and the sibling `pwr` CLI). */
export const updateRoutes = new Hono()
  .get("/updates", (c) => sendData(c, updateStatus()))
  .post("/updates/check", async (c) => sendData(c, await checkForUpdate()))
  .post("/updates/apply", (c) => sendData(c, startUpdate()))
  .put("/updates/config", requireValidation("json", AgentUpdateConfigSchema), (c) => {
    saveTomlConfig({ ...loadTomlConfig(), updates: c.req.valid("json") });
    return sendData(c, updateStatus());
  });

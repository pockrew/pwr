import { sendData } from "@agent/platform/error.handlers";
import { requireValidation } from "@agent/platform/validator.middleware";
import { Hono } from "hono";

import { getSystemDetectedProxy, loadTomlConfig, saveTomlConfig } from "@pockrew/pwr-core";
import { AgentProxyUpdateSchema } from "@pockrew/pwr-shared/schemas";

/** Local uplink settings; loopback target traffic continues to use the raw relay engine. */
export const proxyRoutes = new Hono()
  .get("/proxy", (c) =>
    sendData(c, { config: loadTomlConfig().proxy, detected: getSystemDetectedProxy() }),
  )
  .post("/proxy", requireValidation("json", AgentProxyUpdateSchema), (c) => {
    const config = { ...loadTomlConfig(), proxy: c.req.valid("json") };
    saveTomlConfig(config);
    return sendData(c, { proxy: config.proxy });
  });

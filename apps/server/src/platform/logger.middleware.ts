// @server-only

import { getLogger } from "@logtape/logtape";
import type { AppEnv } from "@server/platform/types";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

const logger = getLogger(["pwr", "server"]);
/** Better Auth's password-reset callback carries a one-time token as a path segment. */
const RESET_TOKEN_PATH = /^(\/api\/auth\/reset-password\/)[^/]+/;

const emit = (
  level: "info" | "warning" | "error",
  payload: Record<string, unknown>,
  requestId?: string,
) => {
  // 1. The event's area becomes the category (`relay.send_failed` → pwr.server.relay).
  const event = typeof payload["event"] === "string" ? payload["event"] : "unknown";
  const child = logger.getChild(event.split(".")[0] || "app");
  // 2. Masking (keys, errors, payload fields) happens in the logging pipeline for every sink.
  const properties = requestId ? { ...payload, requestId } : payload;
  if (level === "error") child.error("{event}", properties);
  else if (level === "warning") child.warning("{event}", properties);
  else child.info("{event}", properties);
};

// Only fixed events and correlation IDs cross the diagnostic boundary; see core logging/redact.
export const log = {
  error: (payload: Record<string, unknown>, requestId: string) => emit("error", payload, requestId),
  info: (payload: Record<string, unknown>, requestId: string) => emit("info", payload, requestId),
  warn: (payload: Record<string, unknown>, requestId: string) =>
    emit("warning", payload, requestId),
};

export const loggerMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const start = performance.now();
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } catch (error) {
    status = error instanceof HTTPException ? error.status : 500;
    throw error;
  } finally {
    logger.getChild("http").info("{method} {path} {status} {ms}ms", {
      method: c.req.method,
      // No query string, headers or body; a reset token in the path is masked.
      path: c.req.path.replace(RESET_TOKEN_PATH, "$1[REDACTED]"),
      status,
      ms: Number((performance.now() - start).toFixed(1)),
      requestId: c.get("requestId"),
    });
  }
});

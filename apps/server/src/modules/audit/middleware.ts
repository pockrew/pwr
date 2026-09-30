import {
  databaseUnavailableError,
  forbiddenError,
  requestIdOf,
} from "@server/platform/error.handlers";
import { log } from "@server/platform/logger.middleware";
import { resolveClientIp } from "@server/platform/securities.middleware";
import type { AppEnv } from "@server/platform/types";
import { createMiddleware } from "hono/factory";

import { recordAudit, recordAuditOutcome } from "./service";

/**
 * Audit every authenticated relay-key request to management, including denied/invalid attempts.
 * @param c - Context containing the verified relay identity, never identity supplied in the body.
 * @param next - Remaining authorization, validation and handler chain.
 * @returns Original response; audit insertion failures return 503 before any config change.
 */
export const auditRelayManagement = createMiddleware<AppEnv>(async (c, next) => {
  const actor = c.get("actor");
  if (actor.types !== "agents") {
    await next();
    return;
  }
  if (actor.keyName === undefined || !actor.tunnelId) throw forbiddenError();

  // 1. Snapshot the key name and trusted request IP; never store body, token, headers or query.
  const id = crypto.randomUUID();
  const details = {
    requestId: requestIdOf(c),
    keyId: actor.id,
    keyName: actor.keyName,
    ip: resolveClientIp(c),
    tunnelId: actor.tunnelId,
    method: c.req.method,
    path: c.req.path,
    status: null,
  };
  try {
    recordAudit({
      id,
      action: "relay.management.request",
      entityType: "api_key",
      entityId: actor.id,
      details: JSON.stringify(details),
    });
  } catch {
    throw databaseUnavailableError("Management audit unavailable");
  }

  // 2. A crash or failed outcome write leaves status=null, meaning an attempt, never success.
  await next();
  try {
    recordAuditOutcome(id, JSON.stringify({ ...details, status: c.res.status }));
  } catch {
    // The initial audit is already durable. Do not turn a committed mutation into a retryable failure.
    log.warn({ event: "audit.outcome_failed", auditId: id }, details.requestId);
  }
});

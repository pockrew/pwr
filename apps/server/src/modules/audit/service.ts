import { getLogger } from "@logtape/logtape";
import type { audit_logs } from "@server/db/schemas";

import { completeAudit, insertAudit } from "./repository";

const logger = getLogger(["pwr", "server", "audit"]);

const parseDetails = (details: string | null | undefined): unknown => {
  try {
    return details ? JSON.parse(details) : null;
  } catch {
    return null;
  }
};

/**
 * Store an audit record, then mirror it to the server log. The database row stays the source of
 * truth (scoped reads, retention); the log copy uses the same JSON Lines format as every other
 * record, so a log shipper configured later receives audit events too.
 * @throws When the row cannot be stored; nothing is logged then.
 */
export const recordAudit = (input: typeof audit_logs.$inferInsert): void => {
  insertAudit(input);
  logger.info("{action} {entityType} {entityId}", {
    auditId: input.id,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: parseDetails(input.details),
  });
};

/**
 * Attach the HTTP outcome to a stored audit record and log the outcome.
 * @throws When the update fails; the caller reports an incomplete outcome.
 */
export const recordAuditOutcome = (id: string, details: string): void => {
  completeAudit(id, details);
  logger.info("Audit {auditId} completed", { auditId: id, details: parseDetails(details) });
};

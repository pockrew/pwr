import { db } from "@server/db/client";
import { tunnels, webhookEvents } from "@server/db/schemas";
import { recordAudit } from "@server/modules/audit/service";
import { ingressEvents } from "@server/modules/ingress/events";
import {
  databaseUnavailableError,
  internalError,
  notFoundError,
  requestIdOf,
  validationError,
} from "@server/platform/error.handlers";
import { chargeIngressQuota, resolveClientIp } from "@server/platform/securities.middleware";
import type { AppEnv } from "@server/platform/types";
import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";

import { providerDeliveryKey, withoutIngressApiKey } from "./headers";
import { verifySignedIngress } from "./signing";

export const findTunnel = async (slug: string) => {
  const records = await db
    .select()
    .from(tunnels)
    .where(and(eq(tunnels.slug, slug), eq(tunnels.isActive, true), isNull(tunnels.deletedAt)))
    .limit(1);

  const record = records[0];
  if (!record) {
    throw notFoundError();
  }

  return record;
};

/** At most one `ingress.hmac_failed` row per tunnel per window; the next row counts the rest. */
const FAILURE_AUDIT_WINDOW_MS = 60_000;
const failureAudits = new Map<string, { at: number; suppressed: number }>();

/**
 * Audit a rejected signature without letting unauthenticated traffic write one row per request.
 * @returns Nothing; a suppressed attempt is counted into the tunnel's next audit row.
 * @throws 503 when the audit row cannot be written, so a rejection is never silently unaudited.
 */
const auditSignatureFailure = (c: Context<AppEnv>, tunnelId: string, provider: string): void => {
  const now = Date.now();
  const last = failureAudits.get(tunnelId);
  if (last && now - last.at < FAILURE_AUDIT_WINDOW_MS) {
    last.suppressed += 1;
    return;
  }
  // Persist only attempt metadata; unverified bytes and credentials never enter history.
  try {
    recordAudit({
      id: crypto.randomUUID(),
      action: "ingress.hmac_failed",
      entityType: "tunnel",
      entityId: tunnelId,
      details: JSON.stringify({
        provider,
        sourceIp: resolveClientIp(c),
        requestId: requestIdOf(c),
        method: c.req.method,
        suppressedSinceLastAudit: last?.suppressed ?? 0,
      }),
    });
  } catch {
    throw databaseUnavailableError("Ingress failure audit unavailable");
  }
  failureAudits.set(tunnelId, { at: now, suppressed: 0 });
};

export interface IIngressConfig {
  tunnelId: string;
  collectionId?: string;
  endpointPath?: string;
}

export const ingress = async (c: Context<AppEnv>, options: IIngressConfig) => {
  const rawHeaders = withoutIngressApiKey(c.req.header());
  const rawQuery = c.req.queries();

  // Store request bytes without decoding, parsing, or re-serializing the body.
  const rawArrayBuf = await c.req.arrayBuffer();
  const rawBytes = new Uint8Array(rawArrayBuf);
  const declaredLength = c.req.header("content-length");
  // Bun exposes an empty Request body for GET/HEAD even if HTTP sent bytes. Fail before
  // persisting/responding success rather than silently replacing the provider payload.
  if (
    (declaredLength !== undefined &&
      /^(0|[1-9]\d*)$/.test(declaredLength) &&
      Number(declaredLength) !== rawBytes.length) ||
    ((c.req.method === "GET" || c.req.method === "HEAD") &&
      c.req.header("transfer-encoding") !== undefined)
  )
    throw validationError("Ingress body could not be read without loss");

  const signing = c.get("ingressSigning");
  if (signing) {
    try {
      verifySignedIngress({ tunnelId: options.tunnelId, ...signing }, c.req.raw.headers, rawBytes);
    } catch (error) {
      auditSignatureFailure(c, options.tunnelId, signing.provider);
      throw error;
    }
  }

  // Authenticated (key checked by middleware, signature above): only now charge tunnel quota.
  const quota = chargeIngressQuota(c, options.tunnelId);
  if ("limited" in quota) return quota.limited;

  // Provider retries (and replays of a captured signed request) collapse onto the first event.
  const providerDeliveryId = providerDeliveryKey(c.req.raw.headers, rawBytes, options);
  const inserted = db
    .insert(webhookEvents)
    .values({
      method: c.req.method,
      contentType: c.req.header("content-type") ?? "application/octet-stream",
      headers: JSON.stringify(rawHeaders),
      queryParams: JSON.stringify(rawQuery),
      rawQuery: new URL(c.req.url).search.slice(1),
      sizeBytes: rawBytes.length,
      payload: Buffer.from(rawBytes),
      collectionId: options.collectionId,
      endpointPath: options.endpointPath,
      sourceIp: resolveClientIp(c),
      userAgent: c.req.header("user-agent"),
      tunnelId: options.tunnelId,
      providerDeliveryId,
      status: 200,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id })
    .get();

  if (inserted) {
    // The subscriber prepares deliveries independently of this committed ingress.
    ingressEvents.emit("stored", inserted.id);
  }
  const record =
    inserted ??
    (providerDeliveryId === null
      ? undefined
      : db
          .select({ id: webhookEvents.id })
          .from(webhookEvents)
          .where(
            and(
              eq(webhookEvents.tunnelId, options.tunnelId),
              eq(webhookEvents.providerDeliveryId, providerDeliveryId),
            ),
          )
          .get());
  if (!record) {
    throw internalError();
  }

  // Receipt confirms durable storage only; never echo the provider body or headers.
  return c.json({ data: record, requestId: requestIdOf(c) }, 200, quota.headers);
};

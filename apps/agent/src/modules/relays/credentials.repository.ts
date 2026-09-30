import { db } from "@agent/db/client";
import {
  localEndpointSecrets,
  localEndpointTargets,
  localRelayKeys,
} from "@agent/db/schemas/relays";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import {
  AgentRelayKeySchema,
  EndpointTargetSchema,
  LocalEndpointCredentialSchema,
  type RelayScope,
} from "@pockrew/pwr-shared/schemas";

const keyScope = (scope: RelayScope) =>
  and(eq(localRelayKeys.serverUrl, scope.serverUrl), eq(localRelayKeys.slug, scope.slug));
const endpointScope = (scope: RelayScope, id: string) =>
  and(
    eq(localEndpointSecrets.serverUrl, scope.serverUrl),
    eq(localEndpointSecrets.slug, scope.slug),
    eq(localEndpointSecrets.endpointId, id),
  );

/**
 * Read the local upgrade credential, optionally replacing it first.
 * @param scope - Normalized server URL and tunnel slug.
 * @param apiKey - Explicit local replacement; never seeded or received from server metadata.
 * @returns Credential for the transport only; missing keys throw 409, storage failures propagate.
 */
export const relayApiKey = (scope: RelayScope, apiKey?: string): string => {
  // 1. Validate before replacing a saved credential; reconnect never invents a default key.
  if (apiKey !== undefined) {
    const value = AgentRelayKeySchema.parse({ apiKey });
    db.insert(localRelayKeys)
      .values({ ...scope, ...value })
      .onConflictDoUpdate({
        target: [localRelayKeys.serverUrl, localRelayKeys.slug],
        set: value,
      })
      .run();
  }
  // 2. Read back the committed value on every connection attempt.
  const row = db.select().from(localRelayKeys).where(keyScope(scope)).get();
  if (!row)
    throw new HTTPException(409, { message: "Configure a local relay key before connecting" });
  return row.apiKey;
};

/** Return credential presence without selecting or serializing the secret value. */
export const relayKeyStatus = (scope: RelayScope) => ({
  configured: Boolean(
    db.select({ slug: localRelayKeys.slug }).from(localRelayKeys).where(keyScope(scope)).get(),
  ),
});

/** Remove a local credential after disabling its session; this does not revoke the server key. */
export const deleteRelayKey = (scope: RelayScope): void => {
  db.delete(localRelayKeys).where(keyScope(scope)).run();
};

/**
 * Store or remove one endpoint's local authentication header.
 * @param scope - Owning server URL and tunnel slug.
 * @param endpointId - Endpoint verified by the local config service at the API boundary.
 * @param secret - Complete header value, or null to remove it.
 * @param headerName - Authentication header; framing/representation headers are forbidden.
 * @throws Validation/storage errors before a caller can report success.
 */
export const setEndpointSecret = (
  scope: RelayScope,
  endpointId: string,
  secret: string | null,
  headerName = "authorization",
): void => {
  if (secret === null) {
    db.delete(localEndpointSecrets).where(endpointScope(scope, endpointId)).run();
    return;
  }
  // Validate through the same schema as the local API; direct repository callers cannot bypass it.
  const credential = LocalEndpointCredentialSchema.parse({ headerName, secret });
  db.insert(localEndpointSecrets)
    .values({ ...scope, endpointId, ...credential })
    .onConflictDoUpdate({
      target: [
        localEndpointSecrets.serverUrl,
        localEndpointSecrets.slug,
        localEndpointSecrets.endpointId,
      ],
      set: credential,
    })
    .run();
};

/** Read a local secret for target execution only; never expose this result in a public DTO. */
export const getEndpointSecret = (scope: RelayScope, endpointId: string) =>
  db
    .select({ headerName: localEndpointSecrets.headerName, secret: localEndpointSecrets.secret })
    .from(localEndpointSecrets)
    .where(endpointScope(scope, endpointId))
    .get() ?? null;

/** Read safe credential metadata for CLI/Studio; never load the value for a status request. */
export const endpointSecretStatus = (scope: RelayScope, endpointId: string) => {
  const row = db
    .select({ headerName: localEndpointSecrets.headerName })
    .from(localEndpointSecrets)
    .where(endpointScope(scope, endpointId))
    .get();
  return { configured: Boolean(row), headerName: row?.headerName ?? null };
};

const targetScope = (scope: RelayScope, id: string) =>
  and(
    eq(localEndpointTargets.serverUrl, scope.serverUrl),
    eq(localEndpointTargets.slug, scope.slug),
    eq(localEndpointTargets.endpointId, id),
  );

/**
 * Store or clear one endpoint's agent-owned target URL.
 * @param url - Validated http(s) target, or null to clear it (deliveries then wait for a target).
 * @throws Validation/storage errors before a caller can report success.
 */
export const setEndpointTarget = (
  scope: RelayScope,
  endpointId: string,
  url: string | null,
): void => {
  if (url === null) {
    db.delete(localEndpointTargets).where(targetScope(scope, endpointId)).run();
    return;
  }
  const value = EndpointTargetSchema.parse(url);
  db.insert(localEndpointTargets)
    .values({ ...scope, endpointId, url: value })
    .onConflictDoUpdate({
      target: [
        localEndpointTargets.serverUrl,
        localEndpointTargets.slug,
        localEndpointTargets.endpointId,
      ],
      set: { url: value },
    })
    .run();
};

/** Read the current agent-owned target; null means the endpoint has no local destination yet. */
export const getEndpointTarget = (scope: RelayScope, endpointId: string): string | null =>
  db
    .select({ url: localEndpointTargets.url })
    .from(localEndpointTargets)
    .where(targetScope(scope, endpointId))
    .get()?.url ?? null;

/** Remove every local-only value owned by a deleted endpoint (target and secret). */
export const deleteEndpointLocalState = (scope: RelayScope, endpointId: string): void => {
  db.delete(localEndpointTargets).where(targetScope(scope, endpointId)).run();
  db.delete(localEndpointSecrets).where(endpointScope(scope, endpointId)).run();
};

import { createHash, randomBytes } from "node:crypto";
import { relayService } from "@server/modules/relays/service";
import { requireManagedTunnel } from "@server/modules/tunnels/service";
import { forbiddenError, notFoundError } from "@server/platform/error.handlers";
import type { Actor } from "@server/platform/types";

import { managementPage } from "@pockrew/pwr-core";
import type { GenerateKeyInput, ManagementPageQuery } from "@pockrew/pwr-shared/schemas";

import * as repository from "./repository";

/**
 * Generate one random credential; only the creation response contains the raw token.
 * @param actor - Account or tunnel-scoped CLI key with keys permission.
 * @param tunnelId - Requested live tunnel.
 * @param input - Direction/name and explicit admin permissions.
 * @returns Token and public metadata; throws 403 for delegated admin issuance, storage errors propagate.
 */
export const generateKey = async (actor: Actor, tunnelId: string, input: GenerateKeyInput) => {
  // 1. Delegation grants transport key management, never minting another admin identity.
  requireManagedTunnel(actor, tunnelId);
  if (input.types === "admin" && actor.types !== "admin") throw forbiddenError();
  // 2. Every direction uses 256 bits of fresh entropy; only admin keys pay the Argon2id cost.
  const id = crypto.randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = input.types === "admin" ? `${id}.${secret}` : `pwr_${input.types}_${secret}`;
  const keyHash =
    input.types === "admin"
      ? await Bun.password.hash(token, { algorithm: "argon2id" })
      : createHash("sha256").update(token).digest("hex");
  // 3. Hashing may yield; recheck that the parent was not deleted while waiting.
  requireManagedTunnel(actor, tunnelId);
  const key = repository.insertKey({
    id,
    tunnelId,
    name: input.name,
    types: input.types,
    permissions: input.types === "admin" ? input.permissions : [],
    keyPrefix: token.slice(0, 16),
    keyHash,
  });
  return { key, token };
};

/**
 * Read paginated key metadata after the HTTP guard verifies keys permission.
 * @param tunnelId - Authorized tunnel identity.
 * @param query - Validated pagination.
 * @returns Bounded cursor page; storage failures propagate.
 */
export const listKeys = (tunnelId: string, query: ManagementPageQuery) =>
  managementPage(repository.listKeys(tunnelId, query), query.limit);

/**
 * Revoke a credential and close an active relay authenticated by that exact key.
 * @param actor - Account or CLI with keys permission.
 * @param tunnelId - Requested live tunnel.
 * @param keyId - Key to revoke; admin keys remain account-only.
 * @returns Revoked metadata; throws 403/404 for unauthorized/missing keys, storage failures propagate.
 */
export const revokeKey = (actor: Actor, tunnelId: string, keyId: string) => {
  // 1. Verify parent and credential type before mutating authorization state.
  requireManagedTunnel(actor, tunnelId);
  const key = repository.findKey(tunnelId, keyId);
  if (!key) throw notFoundError();
  if (key.types === "admin" && actor.types !== "admin") throw forbiddenError();
  // 2. Commit revocation before closing the socket; reconnects must fail immediately.
  const row = repository.revokeKey(tunnelId, keyId);
  if (!row) throw notFoundError();
  if (key.types === "outbound") relayService.closeTunnel(tunnelId, "Relay key revoked", keyId);
  return row;
};

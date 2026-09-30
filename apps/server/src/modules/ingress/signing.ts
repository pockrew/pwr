import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { db } from "@server/db/client";
import { ingressSigning } from "@server/db/schemas";
import { env } from "@server/platform/env";
import {
  AppError,
  forbiddenError,
  internalError,
  validationError,
} from "@server/platform/error.handlers";
import { eq } from "drizzle-orm";

import {
  HmacSigningOptionsSchema,
  type HmacSigningOptions,
  type IngressSigningStatus,
  type SetIngressSigningInput,
} from "@pockrew/pwr-shared/schemas";

import { SIGNATURE_VERIFIERS } from "./signatures";

type SigningConfig = typeof ingressSigning.$inferSelect;

const encryptionKey = () => {
  if (!env.WEBHOOK_SIGNING_ENCRYPTION_KEY) throw internalError("Signing encryption is unavailable");
  return Buffer.from(env.WEBHOOK_SIGNING_ENCRYPTION_KEY, "hex");
};

/** Non-secret options of the generic scheme; null for every other provider or a bad row. */
const optionsOf = (config: SigningConfig): HmacSigningOptions | null => {
  if (!config.options) return null;
  try {
    return HmacSigningOptionsSchema.parse(JSON.parse(config.options));
  } catch {
    return null;
  }
};

/** Return only the selected mode; management responses must never include a signing secret. */
export const signingStatus = (tunnelId: string): IngressSigningStatus => {
  const config = signingConfig(tunnelId);
  return {
    provider: config?.provider ?? "api_key",
    configured: config !== undefined,
    options: config ? optionsOf(config) : null,
    available: Boolean(env.WEBHOOK_SIGNING_ENCRYPTION_KEY),
  };
};

/** A missing row deliberately means the existing API-key ingress mode. */
export const signingConfig = (tunnelId: string): SigningConfig | undefined =>
  db.select().from(ingressSigning).where(eq(ingressSigning.tunnelId, tunnelId)).get();

const encrypt = (secret: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
};

/**
 * Encrypt the replacement secret before the DB write; one tunnel has one signed mode. Without a
 * secret, the saved custom HMAC secret is kept and only its options change.
 * @throws 409 SIGNING_UNAVAILABLE without WEBHOOK_SIGNING_ENCRYPTION_KEY; 400 when a secret is
 *   omitted but no custom HMAC secret is saved.
 */
export const setSigningConfig = (
  tunnelId: string,
  input: SetIngressSigningInput,
): IngressSigningStatus => {
  if (!env.WEBHOOK_SIGNING_ENCRYPTION_KEY)
    throw new AppError(409, "SIGNING_UNAVAILABLE", "WEBHOOK_SIGNING_ENCRYPTION_KEY is not set");
  let encryptedSecret: string;
  if (input.secret === undefined) {
    const saved = signingConfig(tunnelId);
    if (saved?.provider !== input.provider) throw validationError("A signing secret is required");
    encryptedSecret = saved.encryptedSecret;
  } else encryptedSecret = encrypt(input.secret);
  const options = input.provider === "hmac" ? input.options : null;
  const row = {
    provider: input.provider,
    encryptedSecret,
    options: options ? JSON.stringify(options) : null,
  };
  db.insert(ingressSigning)
    .values({ tunnelId, ...row })
    .onConflictDoUpdate({ target: ingressSigning.tunnelId, set: row })
    .run();
  return { provider: input.provider, configured: true, options, available: true };
};

/** Revert to the legacy API-key mode; existing ingress keys can then be used again. */
export const removeSigningConfig = (tunnelId: string): IngressSigningStatus => {
  db.delete(ingressSigning).where(eq(ingressSigning.tunnelId, tunnelId)).run();
  return {
    provider: "api_key",
    configured: false,
    options: null,
    available: Boolean(env.WEBHOOK_SIGNING_ENCRYPTION_KEY),
  };
};

const decrypt = (value: string): string => {
  const data = Buffer.from(value, "base64url");
  if (data.length < 29) throw internalError("Signing configuration is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw internalError("Signing configuration is invalid");
  }
};

/**
 * Verify exactly the received bytes before persistence; no body decoding or rewriting.
 * @throws 403 when the signature is missing, wrong, or outside the replay window.
 */
export const verifySignedIngress = (
  config: SigningConfig,
  headers: Headers,
  rawBody: Uint8Array,
): void => {
  const valid = SIGNATURE_VERIFIERS[config.provider]({
    secret: decrypt(config.encryptedSecret),
    headers,
    body: rawBody,
    now: Date.now() / 1000,
    options: optionsOf(config),
  });
  if (!valid) throw forbiddenError("Invalid provider signature");
};

import { createHmac, timingSafeEqual } from "node:crypto";

import type { HmacSigningOptions, SigningProvider } from "@pockrew/pwr-shared/schemas";

/** Largest clock difference accepted for timestamped signatures (replay window). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** What a verifier needs: the decrypted secret, the received headers and the exact body bytes. */
export interface SignatureInput {
  secret: string;
  headers: Headers;
  body: Uint8Array;
  /** Current time in seconds; injectable for tests. */
  now: number;
  options: HmacSigningOptions | null;
}

const hmac = (algorithm: string, key: string | Buffer, ...parts: (string | Uint8Array)[]) => {
  const mac = createHmac(algorithm, key);
  for (const part of parts) mac.update(part);
  return mac.digest();
};

/** Constant-time comparison of a computed digest with a received encoded signature. */
const sameDigest = (expected: Buffer, received: string, encoding: "hex" | "base64"): boolean => {
  const pattern = encoding === "hex" ? /^[a-fA-F0-9]+$/ : /^[A-Za-z0-9+/]+={0,2}$/;
  if (!pattern.test(received)) return false;
  const actual = Buffer.from(received, encoding);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/** A decimal Unix timestamp within the replay window. */
const freshTimestamp = (value: string | null, now: number): value is string =>
  value !== null &&
  /^(0|[1-9]\d{0,11})$/.test(value) &&
  Math.abs(now - Number(value)) <= SIGNATURE_TOLERANCE_SECONDS;

/** GitHub: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(body)>`. */
const github = ({ secret, headers, body }: SignatureInput): boolean => {
  const value = headers.get("x-hub-signature-256") ?? "";
  return (
    value.startsWith("sha256=") && sameDigest(hmac("sha256", secret, body), value.slice(7), "hex")
  );
};

/** Stripe: `Stripe-Signature: t=<ts>,v1=<hex HMAC-SHA256("<ts>." + body)>`, several v1 allowed. */
const stripe = ({ secret, headers, body, now }: SignatureInput): boolean => {
  const pieces = (headers.get("stripe-signature") ?? "").split(",").map((part) => part.trim());
  const timestamps = pieces.filter((part) => part.startsWith("t="));
  const timestamp = timestamps.length === 1 ? (timestamps[0]?.slice(2) ?? null) : null;
  if (!freshTimestamp(timestamp, now)) return false;
  const expected = hmac("sha256", secret, `${timestamp}.`, body);
  return pieces.some(
    (part) => part.startsWith("v1=") && sameDigest(expected, part.slice(3), "hex"),
  );
};

/**
 * Standard Webhooks / Svix (Clerk, Resend…): `webhook-signature: v1,<base64>` (space-separated
 * list) over `"<id>.<timestamp>." + body`, keyed by the base64 part of `whsec_…`. The `svix-*`
 * header names are accepted too.
 */
const standardWebhooks = ({ secret, headers, body, now }: SignatureInput): boolean => {
  const header = (name: string) => headers.get(`webhook-${name}`) ?? headers.get(`svix-${name}`);
  const id = header("id");
  const timestamp = header("timestamp");
  if (!id || !freshTimestamp(timestamp, now)) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (!key.length) return false;
  const expected = hmac("sha256", key, `${id}.${timestamp}.`, body);
  return (header("signature") ?? "")
    .split(" ")
    .some((entry) => entry.startsWith("v1,") && sameDigest(expected, entry.slice(3), "base64"));
};

/** Shopify: `X-Shopify-Hmac-Sha256: <base64 HMAC-SHA256(body)>`. */
const shopify = ({ secret, headers, body }: SignatureInput): boolean =>
  sameDigest(hmac("sha256", secret, body), headers.get("x-shopify-hmac-sha256") ?? "", "base64");

/** Slack: `X-Slack-Signature: v0=<hex HMAC-SHA256("v0:<ts>:" + body)>` with `X-Slack-Request-Timestamp`. */
const slack = ({ secret, headers, body, now }: SignatureInput): boolean => {
  const timestamp = headers.get("x-slack-request-timestamp");
  const value = headers.get("x-slack-signature") ?? "";
  if (!freshTimestamp(timestamp, now) || !value.startsWith("v0=")) return false;
  return sameDigest(hmac("sha256", secret, `v0:${timestamp}:`, body), value.slice(3), "hex");
};

/** Generic: `<header>: <prefix><hex|base64 HMAC-<algorithm>(body)>` as configured for the tunnel. */
const customHmac = ({ secret, headers, body, options }: SignatureInput): boolean => {
  if (!options) return false;
  const value = headers.get(options.header) ?? "";
  if (!value.startsWith(options.prefix)) return false;
  return sameDigest(
    hmac(options.algorithm, secret, body),
    value.slice(options.prefix.length),
    options.encoding,
  );
};

/** Verifier of each provider scheme; true only for a valid, fresh signature of these exact bytes. */
export const SIGNATURE_VERIFIERS: Record<SigningProvider, (input: SignatureInput) => boolean> = {
  github,
  stripe,
  standard_webhooks: standardWebhooks,
  shopify,
  slack,
  hmac: customHmac,
};

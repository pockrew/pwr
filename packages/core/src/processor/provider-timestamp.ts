import { isRecord } from "@pockrew/pwr-shared/libs";

/**
 * Resolves the genuine event creation timestamp from provider headers or body.
 * Evaluates provider-specific timestamp schemes in order of precedence:
 * 1. Stripe: 'stripe-signature' header (t=<seconds>)
 * 2. Svix / Standard Webhooks: 'webhook-timestamp' header (seconds or milliseconds)
 * 3. Shopify: 'x-shopify-triggered-at' (ISO-8601 string)
 * 4. Standard HTTP: 'date' header (RFC 7231 / RFC 2822)
 * 5. JSON Body inspect: top-level 'created' or 'created_at' if valid number or ISO string
 * 6. Fallback: Server receipt time (Date.now())
 *
 * @param headers - Ingress request headers map.
 * @param body - Optional raw payload body string.
 * @returns Unix epoch timestamp in milliseconds.
 */
export const resolveProviderTimestamp = (
  headers: Record<string, string>,
  body?: string,
): number => {
  const now = Date.now();
  const MAX_SKEW_MS = 30 * 86_400_000; // 30 days sanity window

  // 1. Stripe signature timestamp: t=<seconds>,v1=...
  const stripeSig = headers["stripe-signature"];
  if (stripeSig) {
    const match = stripeSig.match(/t=(\d+)/);
    if (match?.[1]) {
      const sec = Number(match[1]);
      if (!Number.isNaN(sec) && sec > 0) {
        const ms = sec * 1000;
        if (Math.abs(now - ms) < MAX_SKEW_MS) {
          return ms;
        }
      }
    }
  }

  // 2. Svix / Standard Webhooks timestamp: webhook-timestamp=<epoch>
  const svixTimestamp = headers["webhook-timestamp"];
  if (svixTimestamp) {
    const rawVal = Number(svixTimestamp);
    if (!Number.isNaN(rawVal) && rawVal > 0) {
      const ms = rawVal < 100_000_000_000 ? rawVal * 1000 : rawVal;
      if (Math.abs(now - ms) < MAX_SKEW_MS) {
        return ms;
      }
    }
  }

  // 3. Shopify triggered timestamp: x-shopify-triggered-at: <ISO-8601>
  const shopifyTriggeredAt = headers["x-shopify-triggered-at"];
  if (shopifyTriggeredAt) {
    const parsed = Date.parse(shopifyTriggeredAt);
    if (!Number.isNaN(parsed) && Math.abs(now - parsed) < MAX_SKEW_MS) {
      return parsed;
    }
  }

  // 4. Standard HTTP Date header: date: <RFC-7231 / RFC-2822>
  const dateHeader = headers["date"];
  if (dateHeader) {
    const parsed = Date.parse(dateHeader);
    if (!Number.isNaN(parsed) && Math.abs(now - parsed) < MAX_SKEW_MS) {
      return parsed;
    }
  }

  // 5. Inspect JSON body top-level created / created_at
  if (body && body.length > 0 && body.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed)) {
        // Stripe style body: "created": 1612345678 (seconds)
        const created = parsed["created"];
        if (typeof created === "number" && created > 0) {
          const ms = created < 100_000_000_000 ? created * 1000 : created;
          if (Math.abs(now - ms) < MAX_SKEW_MS) return ms;
        }
        // Generic "created_at" in ISO-8601 or epoch
        const createdAt = parsed["created_at"];
        if (typeof createdAt === "string") {
          const t = Date.parse(createdAt);
          if (!Number.isNaN(t) && Math.abs(now - t) < MAX_SKEW_MS) return t;
        }
        if (typeof createdAt === "number" && createdAt > 0) {
          const ms = createdAt < 100_000_000_000 ? createdAt * 1000 : createdAt;
          if (Math.abs(now - ms) < MAX_SKEW_MS) return ms;
        }
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  // 6. Default fallback: Server receipt time
  return now;
};

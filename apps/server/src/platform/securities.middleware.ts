// @server-only
import { isIP } from "node:net";
import { withContext } from "@logtape/logtape";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "hono/bun";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";

import {
  createIpFilter,
  createRateLimiter,
  parseIpList,
  type IRateLimitResult,
} from "@pockrew/pwr-core";
import { ErrorCodes, type IErrorCode } from "@pockrew/pwr-shared/schemas";

import { env } from "./env";
import { requestIdOf, sendError } from "./error.handlers";
import { log } from "./logger.middleware";
import type { AppEnv } from "./types";

export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const id = crypto.randomUUID();
  c.set("requestId", id);

  // Every log record written while handling this request carries its ID.
  await withContext({ requestId: id }, next);

  try {
    c.res.headers.set("x-request-id", id);
  } catch {
    const newHeaders = new Headers(c.res.headers);
    newHeaders.set("x-request-id", id);
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers: newHeaders,
    });
  }
});

export const createBodyLimitMiddleware = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: (c) => {
      const requestId = requestIdOf(c);

      log.warn({ event: "request.payload_too_large", requestId, maxSize }, requestId);

      return sendError(c, ErrorCodes.REQUEST_TOO_LARGE, 413);
    },
  });

export const ingressRateLimiter = createRateLimiter({
  tunnelRateLimitPerSec: env.TUNNEL_RATE_LIMIT_PER_SEC,
  ipRateLimitPerSec: env.IP_RATE_LIMIT_PER_SEC,
  tunnelDailyQuota: env.TUNNEL_DAILY_QUOTA,
});

const trustedProxyList = parseIpList(env.TRUSTED_PROXIES);
const trustedProxyFilter = createIpFilter({ allowlist: trustedProxyList });

/**
 * Resolve the actual socket peer, trusting forwarded headers only through configured proxies.
 * @param c - Request context supplied with the Bun server by the production fetch adapter.
 * @returns Client IP, or "unknown" for in-process requests without connection metadata.
 */
export const resolveClientIp = (c: Context<AppEnv>): string => {
  // 1. Headers cannot establish the direct peer's identity.
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    return "unknown";
  }
  if (!peer || !isIP(peer)) return "unknown";
  if (trustedProxyList.length === 0 || !trustedProxyFilter.isAllowed(peer)) return peer;

  // 2. Walk from the trusted peer toward the client; stop at the first untrusted hop.
  const forwarded = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip");
  if (!forwarded) return peer;
  let client = peer;
  for (const hop of forwarded.split(",").reverse()) {
    if (!trustedProxyFilter.isAllowed(client)) break;
    const candidate = hop.trim();
    if (!isIP(candidate)) return peer;
    client = candidate;
  }
  return client;
};

/** Send a 429 with the limiter's headers and a request ID. */
const rateLimited = (c: Context<AppEnv>, result: IRateLimitResult, tunnelId?: string) => {
  const requestId = requestIdOf(c);
  const errorCode: IErrorCode =
    result.reason === "daily_quota_exceeded" ? ErrorCodes.QUOTA_EXCEEDED : ErrorCodes.RATE_LIMITED;
  log.warn(
    { event: "request.rate_limit_exceeded", tunnelId, clientIp: resolveClientIp(c) },
    requestId,
  );
  const res = c.json({ code: errorCode, requestId }, 429);
  for (const [k, v] of Object.entries(result.headers)) res.headers.set(k, v);
  res.headers.set("x-request-id", requestId);
  return res;
};

/** Per-IP burst limit before the tunnel lookup and auth; unknown slugs are throttled too. */
export const ingressIpRateLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const result = ingressRateLimiter.checkIp(resolveClientIp(c));
  if (result) return rateLimited(c, result);
  await next();
});

/**
 * Charge the per-tunnel burst limit and daily quota. Call only after the request authenticated
 * (API key or provider signature) so unauthenticated traffic cannot exhaust a tunnel's quota.
 * @returns A 429 response when limited, otherwise the quota headers to add to the receipt.
 */
export const chargeIngressQuota = (
  c: Context<AppEnv>,
  tunnelId: string,
): { limited: Response } | { headers: Record<string, string> } => {
  const result = ingressRateLimiter.checkTunnel(tunnelId);
  return result.allowed
    ? { headers: result.headers }
    : { limited: rateLimited(c, result, tunnelId) };
};

export const corsMiddleware = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-api-key", "x-request-id", "x-tunnel-secret"],
  exposeHeaders: [
    "x-request-id",
    "content-length",
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-quota-daily-limit",
    "x-quota-daily-remaining",
    "x-quota-daily-reset",
  ],
  maxAge: 86400,
});

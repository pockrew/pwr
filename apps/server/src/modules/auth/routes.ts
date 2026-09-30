import { resolveClientIp } from "@server/platform/securities.middleware";
import { type AppEnv } from "@server/platform/types";
import { Hono } from "hono";

import { auth, AUTH_CLIENT_IP_HEADER } from "./configs";

/**
 * Better Auth rate-limits sign-in by the IP in its configured header. Rebuild that header from the
 * socket peer (walking X-Forwarded-For only through TRUSTED_PROXIES), so a direct client cannot
 * spoof a fresh IP per attempt to brute-force the admin password.
 */
export const authRoutes = new Hono<AppEnv>().all("/*", (c) => {
  const headers = new Headers(c.req.raw.headers);
  headers.set(AUTH_CLIENT_IP_HEADER, resolveClientIp(c));
  return auth.handler(new Request(c.req.raw, { headers }));
});

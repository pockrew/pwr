import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

// The daemon has no remote authentication protocol; only loopback binding is supported.
const address = z
  .object({
    PWR_AGENT_HOST: z.enum(["127.0.0.1", "localhost", "::1"]).optional(),
    PWR_AGENT_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  })
  .parse(process.env);

export const agentHostname = address.PWR_AGENT_HOST ?? "127.0.0.1";
/** Preferred local API port; when it is busy and no port was pinned, the OS picks a free one. */
export const DEFAULT_AGENT_PORT = 18788;
/** Port pinned with PWR_AGENT_PORT: it must be free, there is no fallback. */
export const pinnedAgentPort = address.PWR_AGENT_PORT;

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
// The Vite dev server (15174) is trusted only outside production builds.
const isProduction = (process.env["NODE_ENV"] ?? "production") === "production";
const originsFor = (port: number) =>
  new Set(
    loopbackHosts.flatMap((host) =>
      (isProduction ? [port] : [port, 15174]).map((trusted) => `http://${host}:${trusted}`),
    ),
  );
let allowedOrigins = originsFor(pinnedAgentPort ?? DEFAULT_AGENT_PORT);

/** Trust Studio served from the port the daemon actually bound. */
export const trustAgentPort = (port: number): void => {
  allowedOrigins = originsFor(port);
};

/** Reject untrusted browser origins and Host headers before any local API or static handler. */
export const localAccessMiddleware = createMiddleware(async (c, next) => {
  const url = new URL(c.req.url);
  const host = c.req.header("host") ?? url.host;
  const origin = c.req.header("origin");
  if (
    !loopbackHosts.includes(url.hostname) ||
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) ||
    (origin !== undefined && !allowedOrigins.has(origin)) ||
    (!origin && c.req.header("sec-fetch-site") === "cross-site")
  ) {
    throw new HTTPException(403);
  }
  await next();
});

export const localCorsMiddleware = cors({
  origin: (origin) => (allowedOrigins.has(origin) ? origin : undefined),
});

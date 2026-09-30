import { timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { agentFiles, readOrCreateSecretFile } from "./data-dir";

/** Cookie Studio holds after opening the tokenized URL printed by `pwr studio`. */
export const SESSION_COOKIE = "pwr_session";

let cachedToken: string | undefined;

/** Agent API token from the owner-only token file, created on first use. */
export const agentToken = (): string => (cachedToken ??= readOrCreateSecretFile(agentFiles.token));

const matches = (candidate: string | undefined): boolean => {
  if (!candidate) return false;
  const expected = Buffer.from(agentToken());
  const received = Buffer.from(candidate);
  return received.length === expected.length && timingSafeEqual(received, expected);
};

// Unit tests exercise routes directly; a dedicated test turns auth back on with PWR_AGENT_AUTH=on.
const authRequired = (): boolean =>
  process.env["NODE_ENV"] !== "test" || process.env["PWR_AGENT_AUTH"] === "on";

/**
 * Require the local API token. The browser guard alone cannot stop another local process or OS
 * user from calling loopback, reading payloads, replaying, or repointing the proxy.
 * Accepts `Authorization: Bearer <token>` (CLI, MCP clients) or the Studio session cookie.
 */
export const localAuthMiddleware = createMiddleware(async (c, next) => {
  if (authRequired()) {
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!matches(bearer) && !matches(getCookie(c, SESSION_COOKIE)))
      throw new HTTPException(401, { message: "Run `pwr studio` or send the agent token" });
  }
  await next();
});

/**
 * Exchange the one-time URL token for an HttpOnly, SameSite=Strict session cookie, then drop
 * the token from the address bar.
 */
export const sessionLoginHandler = createMiddleware(async (c) => {
  if (!matches(c.req.query("token"))) throw new HTTPException(401);
  setCookie(c, SESSION_COOKIE, agentToken(), {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
  });
  return c.redirect("/", 303);
});

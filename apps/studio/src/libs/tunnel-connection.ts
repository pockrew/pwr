import type { AgentRelayTestResult, AgentTunnelSession } from "@pockrew/pwr-shared/schemas";

/** User-facing text for each relay key check verdict. */
export const TEST_MESSAGES: Record<AgentRelayTestResult["result"], string> = {
  ok: "Connection OK: the server accepted this relay key.",
  unauthorized: "The server rejected this key. Use the tunnel's outbound (agent) key.",
  not_found: "No active tunnel with this slug on the server.",
  ip_forbidden: "This machine's IP is blocked by the tunnel's agent IP rules.",
  unreachable: "Could not reach the server. Check the URL, proxy, and network.",
  server_error: "The server returned an error.",
};

/** User-facing text for a saved session's last connection error. */
export const SESSION_ERRORS: Record<NonNullable<AgentTunnelSession["lastError"]>, string> = {
  relay_handshake_failed: "handshake failed; check the slug and relay key",
  connection_lost: "connection lost; retrying",
  local_socket_failed: "could not open the relay socket",
  tunnel_in_use: "another agent owns this tunnel; use Take over to move it to this machine",
};

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** Mirrors the agent's rule: relay keys travel in plaintext only to this machine. */
export const validateServerUrl = (value: string): string | undefined => {
  const clean = value.trim();
  if (!clean) return "Server URL is required";
  let url: URL;
  try {
    url = new URL(clean);
  } catch {
    return "Invalid URL (e.g. https://pwr.example.com)";
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return "Use https:// or http://";
  const insecure = url.protocol === "http:" || url.protocol === "ws:";
  if (insecure && !LOOPBACK.includes(url.hostname.toLowerCase()))
    return "Use https:// (http:// is allowed only for localhost)";
  return undefined;
};

/** Requires a non-blank tunnel slug. */
export const validateSlug = (value: string): string | undefined =>
  value.trim() ? undefined : "Tunnel slug is required";

import { existsSync, readFileSync } from "node:fs";
import { relayApiKey } from "@agent/modules/relays/credentials.repository";
import { agentFiles, readOrCreateSecretFile } from "@agent/platform/data-dir";
import { hc } from "hono/client";
import { HTTPException } from "hono/http-exception";

import { loadTomlConfig, resolveProxyUrl } from "@pockrew/pwr-core";
import type { AppType } from "@pockrew/pwr-server/rpc";
import {
  RELAY_AGENT_ID_HEADER,
  RELAY_TAKEOVER_HEADER,
  type AgentRelayTest,
  type AgentRelayTestResult,
  type RelayScope,
} from "@pockrew/pwr-shared/schemas";

/**
 * Normalizes a user-entered relay server URL to its HTTP(S) base.
 * @throws 400 when http:// targets a non-loopback host (the relay key would travel in plaintext).
 */
export const relayServerUrl = (serverWsUrl: string): string => {
  const url = new URL(serverWsUrl);
  if (
    !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid relay server URL");
  }
  url.protocol =
    url.protocol === "ws:" ? "http:" : url.protocol === "wss:" ? "https:" : url.protocol;
  // The relay key rides in the upgrade and sync headers: plaintext only to this machine.
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())
  )
    throw new HTTPException(400, {
      message: "Relay server must use https:// (http:// is allowed only for localhost)",
    });
  return url.toString().replace(/\/+$/, "");
};

/** Proxy and custom-CA options from the local config for an outbound request (relay server, config sync, release downloads). */
export const relayTransportOptions = (url: string): { proxy?: string; tls?: { ca: string } } => {
  const config = loadTomlConfig();
  const proxy = resolveProxyUrl(url, config.proxy);
  const ca =
    config.proxy.caCertPath && existsSync(config.proxy.caCertPath)
      ? readFileSync(config.proxy.caCertPath, "utf8")
      : undefined;
  return { ...(proxy ? { proxy } : {}), ...(ca ? { tls: { ca } } : {}) };
};

const checkResults: Record<number, AgentRelayTestResult["result"]> = {
  401: "unauthorized",
  403: "unauthorized",
  404: "not_found",
};

/**
 * Asks the server whether a relay key is valid for a slug, without storing a key or opening a
 * socket (which would replace this tunnel's active agent).
 * @returns The server's verdict; network failures map to `unreachable`, never a throw.
 */
export const checkRelayKey = async (input: AgentRelayTest): Promise<AgentRelayTestResult> => {
  const serverUrl = relayServerUrl(input.serverWsUrl);
  // Read-only lookup when no key is given; throws 409 if none is saved.
  const apiKey = input.apiKey ?? relayApiKey({ serverUrl, slug: input.slug });
  const rpc = hc<AppType>(serverUrl, {
    headers: { "x-api-key": apiKey },
    fetch: (url: string | Request | URL, init?: RequestInit) =>
      fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        ...relayTransportOptions(String(url)),
      }),
  });
  const response = await rpc.relay[":slug"].check
    .$get({ param: { slug: input.slug } })
    .catch(() => null);
  if (!response) return { result: "unreachable" };
  if (response.ok) return { result: "ok", status: response.status };
  // 403 is also the IP filter's status; its error body names it.
  const body: unknown = await response.json().catch(() => null);
  const ipForbidden =
    typeof body === "object" && body !== null && "code" in body && body.code === "IP_FORBIDDEN";
  const result = ipForbidden ? "ip_forbidden" : (checkResults[response.status] ?? "server_error");
  return { result, status: response.status };
};

/**
 * Opens the server's typed Hono WebSocket RPC with the key loaded from local SQLite.
 * @param scope - Normalized server base URL and tunnel slug.
 * @returns Bun WebSocket; throws if local credentials, TLS config or socket creation fail.
 */
export const openRelaySocket = (
  scope: RelayScope,
  acceptDeliveries = true,
  takeover = false,
): WebSocket => {
  const key = relayApiKey(scope);
  // Hono derives /relay/:slug from AppType; import type does not load server runtime code.
  const rpc = hc<AppType>(scope.serverUrl, {
    webSocket: (url) => {
      const options: Bun.WebSocketOptions = {
        headers: {
          "x-api-key": key,
          "x-relay-result-receipts": "1",
          // A full agent still needs result confirmations to release safely prunable history.
          "x-relay-accept-deliveries": acceptDeliveries ? "1" : "0",
          // Lets the server tell this agent's own reconnect apart from a second machine.
          [RELAY_AGENT_ID_HEADER]: readOrCreateSecretFile(agentFiles.instanceId),
          ...(takeover ? { [RELAY_TAKEOVER_HEADER]: "1" } : {}),
        },
      };
      // Keep proxy/custom-CA support from the existing client connection path.
      Object.assign(options, relayTransportOptions(String(url)));
      // Root typecheck also loads DOM's overload, which omits Bun's header options.
      const socket: unknown = Reflect.construct(WebSocket, [url, options]);
      if (!(socket instanceof WebSocket)) throw new Error("Relay socket creation failed");
      return socket;
    },
  });
  // Credentials belong in the HTTP upgrade header, never in query parameters or a subscribe frame.
  return rpc.relay[":slug"].$ws({ param: { slug: scope.slug } });
};

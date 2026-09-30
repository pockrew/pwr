import { readFileSync, rmSync, writeFileSync } from "node:fs";

import { agentFiles, ensureAgentDataDir } from "./data-dir";
import { agentHostname, DEFAULT_AGENT_PORT, pinnedAgentPort, trustAgentPort } from "./local-access";

const isAddressInUse = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "EADDRINUSE";

/**
 * Bind the loopback API and record the bound port in `agent.port` for the CLI.
 * 1. A pinned port (PWR_AGENT_PORT) must be free; there is no fallback.
 * 2. Otherwise the default port is preferred; when another process holds it, the OS picks a free
 *    port, so a port conflict never stops the agent.
 * 3. The record is removed when this process exits.
 * @param fetch - Local API request handler.
 * @param port - Preferred port; defaults to the pinned or default port.
 * @param fallback - Whether a busy port may be replaced by a free one.
 * @returns The running server; throws when no port can be bound.
 */
export const listenLocalApi = (
  fetch: (request: Request) => Response | Promise<Response>,
  port = pinnedAgentPort ?? DEFAULT_AGENT_PORT,
  fallback = pinnedAgentPort === undefined,
) => {
  const serve = (candidate: number) =>
    Bun.serve({ hostname: agentHostname, port: candidate, fetch });
  let server: ReturnType<typeof serve>;
  try {
    server = serve(port);
  } catch (error) {
    if (!fallback || !isAddressInUse(error)) throw error;
    server = serve(0);
  }
  const bound = server.port ?? port;
  trustAgentPort(bound);
  ensureAgentDataDir();
  writeFileSync(agentFiles.port, `${bound}\n`, { mode: 0o600 });
  process.once("exit", () => {
    try {
      if (readFileSync(agentFiles.port, "utf8").trim() === String(bound)) rmSync(agentFiles.port);
    } catch {
      // Already removed.
    }
  });
  return server;
};

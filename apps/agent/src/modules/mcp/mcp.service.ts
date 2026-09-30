import { tunnelManager } from "@agent/modules/relays/service";
import {
  getRequest,
  listDeliveries,
  listRequests,
  replayRequest,
} from "@agent/modules/storage/service";
import { HTTPException } from "hono/http-exception";
import { z, ZodError } from "zod";

import { loadTomlConfig } from "@pockrew/pwr-core";
import { AgentMcpTools } from "@pockrew/pwr-shared/schemas";

/** Tools with side effects on local targets; hidden unless `[mcp] allow_replay = true`. */
const MUTATING_TOOLS = new Set(["replay_request"]);
const replayAllowed = (): boolean => loadTomlConfig().mcp.allowReplay;

/** Advertise exactly the schemas validated below; no legacy organization or target override inputs. */
export const getMcpToolsList = () =>
  Object.entries(AgentMcpTools)
    .filter(([name]) => replayAllowed() || !MUTATING_TOOLS.has(name))
    .map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.schema),
    }));

/**
 * Execute a local MCP tool through the same services as HTTP clients.
 * @param name - Advertised tool name; unknown names never execute an operation.
 * @param args - Untrusted arguments, parsed by that tool's shared schema.
 * @param defaultProject - Optional compatibility filter for stdio callers.
 * @returns MCP content or a redacted tool error; original payload bytes remain in local storage.
 */
export const executeMcpTool = async (
  name: string,
  args: Record<string, unknown>,
  defaultProject?: string,
) => {
  try {
    const input =
      defaultProject && args["project_id"] === undefined
        ? { ...args, project_id: defaultProject }
        : args;
    let result: unknown;
    // Webhook bodies returned by get_request are untrusted text; an LLM must not be able to turn
    // them into target calls unless the user opted in.
    if (MUTATING_TOOLS.has(name) && !replayAllowed())
      return {
        content: [{ type: "text", text: "REPLAY_DISABLED: set [mcp] allow_replay = true" }],
        isError: true,
        isRetryable: false,
      };
    if (name === "list_tunnels") {
      const filter = AgentMcpTools.list_tunnels.schema.parse(input);
      result = tunnelManager
        .getTunnels()
        .filter(
          (tunnel) =>
            (!filter.project_id || tunnel.projectId === filter.project_id) &&
            (filter.status === "all" ||
              (filter.status === "online"
                ? tunnel.status === "connected"
                : tunnel.status !== "connected")),
        );
    } else if (name === "get_tunnel_status") {
      const filter = AgentMcpTools.get_tunnel_status.schema.parse(input);
      const tunnel = tunnelManager.getTunnel(filter.tunnel_id);
      if (!tunnel || (filter.project_id && tunnel.projectId !== filter.project_id))
        throw new HTTPException(404);
      result = tunnel;
    } else if (name === "list_requests") {
      const filter = AgentMcpTools.list_requests.schema.parse(input);
      result = listRequests({
        tunnelId: filter.tunnel_id,
        projectId: filter.project_id,
        method: filter.method,
        limit: filter.limit,
        cursor: filter.cursor,
      });
    } else if (name === "get_request") {
      const filter = AgentMcpTools.get_request.schema.parse(input);
      result = getRequest(filter.request_id, {
        tunnelId: filter.tunnel_id,
        projectId: filter.project_id,
      });
    } else if (name === "list_deliveries") {
      const filter = AgentMcpTools.list_deliveries.schema.parse(input);
      result = listDeliveries(filter.request_id, {
        tunnelId: filter.tunnel_id,
        projectId: filter.project_id,
        limit: filter.limit,
        cursor: filter.cursor,
      });
    } else if (name === "replay_request") {
      const filter = AgentMcpTools.replay_request.schema.parse(input);
      result = await replayRequest(filter.request_id, {
        tunnelId: filter.tunnel_id,
        projectId: filter.project_id,
      });
    } else {
      return {
        content: [{ type: "text", text: "UNKNOWN_TOOL" }],
        isError: true,
        isRetryable: false,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    // A failed replay may already have reached the target; never advertise automatic retries.
    const code =
      error instanceof ZodError
        ? "INVALID_TOOL_INPUT"
        : error instanceof HTTPException
          ? error.status === 404
            ? "NOT_FOUND"
            : error.status === 409
              ? "SELECT_DELIVERY_ID"
              : "INVALID_TOOL_INPUT"
          : "EXECUTION_ERROR";
    return { content: [{ type: "text", text: code }], isError: true, isRetryable: false };
  }
};

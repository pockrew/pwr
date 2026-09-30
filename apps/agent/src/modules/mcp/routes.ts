import { requireValidation } from "@agent/platform/validator.middleware";
import { Hono } from "hono";

import { PWR_VERSION } from "@pockrew/pwr-shared/libs";
import {
  AgentMcpCallSchema,
  AgentMcpInitializeSchema,
  AgentMcpRequestSchema,
} from "@pockrew/pwr-shared/schemas";

import { executeMcpTool, getMcpToolsList } from "./mcp.service";

const SUPPORTED_MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Stateless local JSON-RPC transport; tool execution remains in the existing service. */
export const mcpRoutes = new Hono().post(
  "/mcp",
  requireValidation("json", AgentMcpRequestSchema),
  async (c) => {
    const body = c.req.valid("json");
    // Notifications have no response ID and must not accidentally invoke a mutating tool.
    if (body.id === undefined) return c.body(null, 204);
    const envelope = { jsonrpc: "2.0", id: body.id };
    if (body.method === "initialize") {
      const input = AgentMcpInitializeSchema.safeParse(body.params);
      if (!input.success)
        return c.json({
          ...envelope,
          error: { code: -32602, message: "Invalid initialize parameters" },
        });
      // Stateless JSON over POST, tools only: valid for each listed revision. Echo a supported
      // requested version, else offer the newest.
      const protocolVersion = SUPPORTED_MCP_VERSIONS.includes(input.data.protocolVersion)
        ? input.data.protocolVersion
        : SUPPORTED_MCP_VERSIONS[0];
      return c.json({
        ...envelope,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "pwr-agent", version: PWR_VERSION },
        },
      });
    }
    if (body.method === "ping") return c.json({ ...envelope, result: {} });
    if (body.method === "tools/list")
      return c.json({ ...envelope, result: { tools: getMcpToolsList() } });
    if (body.method === "tools/call") {
      const input = AgentMcpCallSchema.safeParse(body.params);
      if (!input.success)
        return c.json({
          ...envelope,
          error: { code: -32602, message: "Invalid tool call parameters" },
        });
      return c.json({
        ...envelope,
        result: await executeMcpTool(input.data.name, input.data.arguments),
      });
    }
    return c.json({ ...envelope, error: { code: -32601, message: "Method not found" } });
  },
);

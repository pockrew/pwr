import type {
  MaintenanceActionResult,
  WebhookDelivery,
  WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

export interface IServerTunnelItem {
  id: string;
  name: string;
  projectId?: string | undefined;
  targetUrl: string;
  isOnline: boolean;
  connectedAgents: number;
}

/** `2 delivered · 1 failed · 1 pending`, or `-` when the agent has no deliveries for it. */
export const formatDeliverySummary = (event: WebhookEvent): string => {
  const summary = event.deliveries;
  if (!summary?.total) return "-";
  const parts = [
    summary.succeeded ? `${summary.succeeded} delivered` : "",
    summary.failed ? `${summary.failed} failed` : "",
    summary.pending ? `${summary.pending} pending` : "",
  ];
  return parts.filter(Boolean).join(" · ");
};

/**
 * Formats a list of server tunnels into an aligned Markdown table for MCP tool output.
 *
 * @param tunnels - List of server tunnel summary items.
 * @param publicBaseUrl - Public base ingress URL.
 */
export const formatTunnelsList = (
  tunnels: readonly IServerTunnelItem[],
  publicBaseUrl: string,
): string => {
  // 1. Return fallback notice if no tunnels registered
  if (tunnels.length === 0) {
    return "No tunnels registered for this organization.";
  }

  // 2. Initialize Markdown table header
  const lines: string[] = [
    "### Registered Webhook Tunnels",
    "",
    "| Tunnel ID | Project | Name | Status | Agents | Forward Target | Ingress Endpoint |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
  ];

  // 3. Format individual rows with status badge and ingress endpoint
  for (const t of tunnels) {
    const statusIcon = t.isOnline ? "🟢 ONLINE" : "⚪ OFFLINE";
    const ingressUrl = `${publicBaseUrl}/${t.id}`;
    const project = t.projectId ?? "default";
    lines.push(
      `| \`${t.id}\` | \`${project}\` | ${t.name} | ${statusIcon} | ${t.connectedAgents} | \`${t.targetUrl}\` | \`${ingressUrl}\` |`,
    );
  }

  // 4. Return combined Markdown document
  return lines.join("\n");
};

/**
 * Formats detailed tunnel status and readiness into a Markdown report for MCP responses.
 *
 * @param tunnelId - Tunnel identifier.
 * @param isOnline - Whether any forwarding agent is connected.
 * @param connectedAgents - Count of connected forwarders.
 * @param publicBaseUrl - Public ingress base URL.
 * @param targetUrl - Local destination target URL.
 * @param projectId - Optional project tenancy identifier.
 */
export const formatTunnelStatus = (
  tunnelId: string,
  isOnline: boolean,
  connectedAgents: number,
  publicBaseUrl: string,
  targetUrl: string,
  projectId = "default",
): string => {
  // 1. Resolve operational status badge
  const statusBadge = isOnline ? "🟢 ONLINE (Connected)" : "🔴 OFFLINE (No active CLI forwarder)";

  // 2. Determine readiness advisory text
  const readiness = isOnline
    ? "✅ Ready for testing: Inbound webhooks will be immediately forwarded to localhost."
    : "⚠️ Warning: Tunnel has no active CLI forwarders connected. Start 'wr' to receive traffic.";

  // 3. Assemble and return formatted status document
  return [
    `### Tunnel Status: ${tunnelId}`,
    `- **Project ID**: \`${projectId}\``,
    `- **Operational State**: ${statusBadge}`,
    `- **Active Forwarding Agents**: ${connectedAgents}`,
    `- **Public Ingress URL**: \`${publicBaseUrl}/${tunnelId}\``,
    `- **Target Local URL**: \`${targetUrl}\``,
    "",
    readiness,
  ].join("\n");
};

/**
 * Formats a list of captured webhook events into a Markdown summary table.
 *
 * @param requests - Webhook events array.
 * @param tunnelId - Target tunnel identifier.
 * @param projectId - Optional project tenancy scope.
 */
export const formatRequestsList = (
  requests: readonly WebhookEvent[],
  tunnelId: string,
  projectId = "default",
): string => {
  // 1. Return notice if no requests have been logged yet
  if (requests.length === 0) {
    return `No webhook requests captured for tunnel '${tunnelId}' (project: '${projectId}') yet.`;
  }

  // 2. Build Markdown table headers
  const lines: string[] = [
    `### Captured Webhooks for Tunnel: ${tunnelId} | Project: ${projectId} (Count: ${requests.length})`,
    "",
    "| Request ID | Method | Deliveries | Last Target Status | Captured At | Headers Count |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
  ];

  // 3. Iterate requests and append formatted table rows
  for (const req of requests) {
    const time = new Date(req.createdAt).toISOString();
    const headersCount = Object.keys(req.headers).length;
    lines.push(
      `| \`${req.id}\` | **${req.method}** | ${formatDeliverySummary(req)} | ${req.status ?? "-"} | ${time} | ${headersCount} |`,
    );
  }

  // 4. Append inspection tip and return formatted string
  lines.push("");
  lines.push(
    "💡 *Tip: Call `get_request` with a `request_id` to inspect the full raw payload and headers.*",
  );
  return lines.join("\n");
};

/**
 * Formats full webhook request details including headers, query parameters, and JSON payload.
 *
 * @param event - The WebhookEvent entity to inspect.
 */
export const formatRequestDetail = (event: WebhookEvent): string => {
  // 1. Format timestamp and YAML header representation
  const time = new Date(event.createdAt).toISOString();
  const headerLines: string[] = [];
  for (const [k, v] of Object.entries(event.headers)) {
    headerLines.push(`  ${k}: ${v}`);
  }

  // 2. Format optional query parameters block
  const querySection =
    event.queryParams && Object.keys(event.queryParams).length > 0
      ? `\n#### Query Parameters\n\`\`\`json\n${JSON.stringify(event.queryParams, null, 2)}\n\`\`\``
      : "";

  // 3. Pretty-print JSON body if valid JSON
  let formattedBody = event.body ?? "(empty body)";
  if (event.body) {
    try {
      const parsedJson: unknown = JSON.parse(event.body);
      formattedBody = JSON.stringify(parsedJson, null, 2);
    } catch {
      // Keep raw string
    }
  }

  // 4. Return assembled Markdown inspection report
  return [
    `### Webhook Request: ${event.id}`,
    `- **Project ID**: \`${event.projectId}\``,
    `- **Tunnel ID**: \`${event.tunnelId}\``,
    `- **HTTP Method**: \`${event.method}\``,
    `- **Captured Timestamp**: \`${time}\``,
    `- **Deliveries**: ${formatDeliverySummary(event)}`,
    `- **Last Target Result**: ${event.status === undefined ? "none yet" : `HTTP ${event.status} in ${event.executionTimeMs ?? 0}ms`}`,
    querySection,
    "",
    "#### Inbound HTTP Headers",
    "```yaml",
    headerLines.join("\n"),
    "```",
    "",
    "#### Raw Payload Body",
    "```json",
    formattedBody,
    "```",
  ].join("\n");
};

/**
 * Formats the result of a local webhook replay execution into Markdown.
 *
 * @param delivery - Resulting WebhookDelivery record.
 * @param targetUrl - Target local destination URL.
 */
export const formatReplayResult = (delivery: WebhookDelivery, targetUrl: string): string => {
  // 1. Determine delivery success status badge
  const isSuccess = delivery.statusCode >= 200 && delivery.statusCode < 300;
  const badge = isSuccess
    ? `🟢 SUCCESS (${delivery.statusCode})`
    : `🔴 FAILED (${delivery.statusCode})`;

  // 2. Truncate response body snippet to prevent oversized output
  let bodySnippet = delivery.responseBody ?? "(no response body)";
  if (bodySnippet.length > 500) {
    bodySnippet = bodySnippet.slice(0, 500) + "... [truncated]";
  }

  // 3. Assemble and return replay result Markdown
  return [
    "### Webhook Replay Execution Result",
    `- **Outcome**: ${badge}`,
    `- **Target URL**: \`${targetUrl}\``,
    `- **Replayed Webhook ID**: \`${delivery.webhookId}\``,
    `- **Project ID**: \`${delivery.projectId}\``,
    `- **Local Server Status**: \`${delivery.statusCode}\``,
    `- **Roundtrip Latency**: \`${delivery.latencyMs}ms\``,
    "",
    "#### Local Response Snippet",
    "```",
    bodySnippet,
    "```",
  ].join("\n");
};

/**
 * Formats the outcome of a retention maintenance operation (cleanup or sync).
 *
 * @param result - MaintenanceActionResult summary object.
 */
export const formatMaintenanceResult = (result: MaintenanceActionResult): string => {
  // 1. Resolve operation type titles and count labels
  const isClean = result.action === "clean";
  const title = isClean ? "🧹 History Cleanup Completed" : "🔄 Webhook Re-Sync Completed";
  const statLabel = isClean ? "Deleted Webhooks" : "Synced Webhooks";
  const count = isClean ? (result.deletedCount ?? 0) : (result.syncedCount ?? 0);

  // 2. Format project scope description
  const projectsStr =
    result.affectedProjects.length > 0 ? result.affectedProjects.join(", ") : "All projects";

  // 3. Assemble summary lines
  const lines: string[] = [
    `### ${title}`,
    `- **Target Projects**: \`${projectsStr}\``,
    `- **${statLabel}**: **${count}** items`,
    `- **Execution Time**: ${result.durationMs}ms`,
  ];

  if (result.warningMessage) {
    lines.push(`- **Notice**: ⚠️ ${result.warningMessage}`);
  }

  // 4. Return combined report
  return lines.join("\n");
};

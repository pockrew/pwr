import { formatDeliverySummary } from "@pockrew/pwr-core";
import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

import {
  agentGetRequest,
  agentListRequestDeliveries,
  agentListRequests,
  agentPort,
  checkAgentHealth,
  createAgentRpcClient,
} from "~/client/daemon.client";
import { colorize, colors } from "~/ui/ansi";
import { renderTable, type ITableColumn, type TableRow } from "~/ui/table";

export interface IInspectCommandOptions {
  id?: string | undefined;
  tunnelId?: string | undefined;
  projectId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  port?: number | undefined;
}

/**
 * Formats a timestamp into a short localized time string (e.g. '14:32:05').
 *
 * @param timestamp - Epoch milliseconds.
 * @returns Formatted time string.
 */
const formatTime = (timestamp?: number): string => {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString();
};

/**
 * Formats byte size into human-readable representation (e.g. '1.2 KB').
 *
 * @param bytes - Size in bytes.
 * @returns Human-readable byte size.
 */
const formatByteSize = (bytes?: number): string => {
  if (bytes === undefined || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * CLI command controller that inspects captured webhook requests stored in the Agent's SQLite database.
 *
 * @param options - Inspection filtering or detail options.
 */
export const executeInspectCommand = async (options: IInspectCommandOptions): Promise<void> => {
  const port = agentPort(options.port);

  // 1. Read-only: never start the agent as a side effect of inspecting.
  if (!(await checkAgentHealth(port)).online) {
    console.error(
      colorize(
        `✕ Agent is not running on port ${port}; start it with: pwr agent start`,
        colors.brightRed,
      ),
    );
    process.exit(1);
  }

  const client = createAgentRpcClient(port);

  // 2. Detail view branch: inspect a single event by UUID
  if (options.id) {
    let event: WebhookEvent | null;
    try {
      event = await agentGetRequest(client, options.id, {
        tunnelId: options.tunnelId,
        projectId: options.projectId,
      });
    } catch (error) {
      console.error(
        `${colorize("✕ Agent request failed:", colors.brightRed)} ${error instanceof Error ? error.message : "RPC failure"}`,
      );
      process.exit(1);
    }
    if (!event) {
      console.error(
        `${colorize("✕ Event not found:", colors.brightRed)} ${colorize(options.id, colors.bold)}`,
      );
      process.exit(1);
    }

    console.log(`\n${colorize("═══ WEBHOOK EVENT DETAILS ═══", colors.bold)}`);
    console.log(`${colorize("ID:", colors.dim)} ${colorize(event.id, colors.bold)}`);
    console.log(`${colorize("Tunnel:", colors.dim)} ${event.tunnelId ?? "default"}`);
    console.log(`${colorize("Project:", colors.dim)} ${event.projectId ?? "default"}`);
    console.log(`${colorize("Method:", colors.dim)} ${colorize(event.method, colors.brightCyan)}`);
    if (event.queryParams && Object.keys(event.queryParams).length)
      console.log(`${colorize("Query:", colors.dim)} ${new URLSearchParams(event.queryParams)}`);
    console.log(`${colorize("Deliveries:", colors.dim)} ${formatDeliverySummary(event)}`);
    console.log(`${colorize("Timestamp:", colors.dim)} ${new Date(event.createdAt).toISOString()}`);

    console.log(`\n${colorize("--- Headers ---", colors.bold)}`);
    const headers =
      typeof event.headers === "object" && event.headers !== null ? event.headers : {};
    for (const [key, value] of Object.entries(headers)) {
      console.log(`  ${colorize(key, colors.dim)}: ${String(value)}`);
    }

    console.log(`\n${colorize("--- Payload ---", colors.bold)}`);
    const rawBytes = event.rawPayloadBase64 ? Buffer.from(event.rawPayloadBase64, "base64") : null;
    let payloadText = event.payloadText ?? event.body;
    if (payloadText === undefined && rawBytes && rawBytes.length > 0) {
      try {
        payloadText = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
      } catch {
        // The original bytes remain in Agent storage; display only their size here.
      }
    }
    if (payloadText) {
      try {
        const parsed = JSON.parse(payloadText);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(payloadText);
      }
    } else if (rawBytes?.length) {
      console.log(colorize(`(binary payload, ${formatByteSize(rawBytes.length)})`, colors.dim));
    } else {
      console.log(colorize("(empty body)", colors.dim));
    }
    // One event can fan out to several endpoints; replay must select a delivery ID.
    try {
      const deliveries = await agentListRequestDeliveries(client, event.id, {
        tunnelId: options.tunnelId,
        projectId: options.projectId,
      });
      console.log(`\n${colorize("--- Deliveries ---", colors.bold)}`);
      for (const delivery of deliveries) {
        const outcome = delivery.result
          ? `HTTP ${delivery.result.statusCode} in ${delivery.result.latencyMs}ms`
          : "pending";
        console.log(
          `  ${colorize(delivery.id, colors.brightCyan)}  ${delivery.trigger.padEnd(6)} ${delivery.endpointId}  ${outcome}  ${delivery.localTarget ?? "(no target set)"}`,
        );
      }
      if (deliveries.length > 0) {
        console.log(`${colorize("Replay:", colors.dim)} pwr replay <delivery-id>`);
      }
      console.log();
    } catch (error) {
      console.error(
        `${colorize("✕ Could not load delivery IDs:", colors.brightRed)} ${error instanceof Error ? error.message : "Agent RPC failed"}`,
      );
      process.exit(1);
    }
    return;
  }

  // 3. List view branch: query requests matching filters
  let page: Awaited<ReturnType<typeof agentListRequests>>;
  try {
    page = await agentListRequests(client, {
      limit: options.limit ?? 25,
      cursor: options.cursor,
      tunnelId: options.tunnelId,
      projectId: options.projectId,
    });
  } catch (error) {
    console.error(
      `${colorize("✕ Agent request failed:", colors.brightRed)} ${error instanceof Error ? error.message : "RPC failure"}`,
    );
    process.exit(1);
  }
  const events = page.items;

  if (events.length === 0) {
    console.log(`\n${colorize("No webhook requests found in local store.", colors.dim)}\n`);
    return;
  }

  // 4. Format requests as table
  const columns: readonly ITableColumn[] = [
    { header: "#", key: "index", width: 3, align: "center" },
    { header: "TIME", key: "time", width: 10 },
    { header: "METHOD", key: "method", width: 8 },
    { header: "DELIVERIES", key: "deliveries", width: 26 },
    { header: "LAST", key: "last", width: 5, align: "right" },
    { header: "SIZE", key: "size", width: 9, align: "right" },
    { header: "ID", key: "id", width: 36 },
  ];

  const rows: TableRow[] = events.map((ev: WebhookEvent, idx: number) => {
    const bodyLen = ev.sizeBytes ?? (ev.body ? new TextEncoder().encode(ev.body).length : 0);

    return {
      index: idx + 1,
      time: colorize(formatTime(ev.createdAt), colors.dim),
      method: colorize(ev.method, colors.bold),
      deliveries: formatDeliverySummary(ev),
      last: ev.status === undefined ? "-" : String(ev.status),
      size: formatByteSize(bodyLen),
      id: colorize(ev.id, colors.dim),
    };
  });

  console.log(
    `\n${colorize("CAPTURED WEBHOOKS", colors.bold)} ${colorize(`(${events.length} latest)`, colors.dim)}:`,
  );
  console.log(renderTable(columns, rows));
  if (page.nextCursor)
    console.log(
      `${colorize("Next cursor:", colors.dim)} ${page.nextCursor} (use pwr inspect --cursor <value> with the same filters)`,
    );
  console.log(
    `\n${colorize("Hint:", colors.dim)} Run ${colorize("pwr inspect <event-id>", colors.brightCyan)} to view payload and delivery IDs, then ${colorize("pwr replay <delivery-id>", colors.brightCyan)}.\n`,
  );
};

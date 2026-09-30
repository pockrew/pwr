import { formatBytes } from "@pockrew/pwr-core";
import type {
  AgentDeliveryStream,
  WebhookDelivery,
  WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

import { colorize, colors } from "./ansi";

/**
 * Pads a single integer with leading zeros to double-digit length.
 *
 * @param n - Number to pad.
 * @returns Formatted 2-character string.
 */
const pad = (n: number): string => n.toString().padStart(2, "0");

/**
 * Formats a Date instance into human-readable HH:MM:SS format.
 *
 * @param date - Date object to format.
 * @returns Formatted timestamp string.
 */
const formatTimestamp = (date: Date = new Date()): string => {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/**
 * Formats a single webhook event with delivery status and latency for realtime CLI log streaming.
 *
 * @param event - The incoming WebhookEvent model.
 * @param delivery - Optional forward delivery outcome record.
 * @returns Colorized single-line log representation.
 */
export const formatWebhookEventLine = (
  event: WebhookEvent,
  delivery?: WebhookDelivery | undefined,
): string => {
  // 1. Format human-readable event timestamp
  const time = colorize(formatTimestamp(new Date(event.createdAt)), colors.dim);

  // 2. Determine HTTP method color and build badge
  const methodColor =
    event.method === "POST"
      ? colors.brightCyan
      : event.method === "GET"
        ? colors.brightGreen
        : event.method === "DELETE"
          ? colors.brightRed
          : colors.brightYellow;
  const methodBadge = colorize(event.method.padEnd(6), methodColor);

  // 3. Show the original path only when it was recorded; a tunnel ID is not a URL path.
  let path = "(path unavailable)";
  if (event.url) {
    try {
      const parsed = new URL(event.url);
      path = parsed.pathname + (parsed.search || "");
    } catch {
      path = event.url;
    }
  }
  const pathDisplay = (path.length > 25 ? path.slice(0, 22) + "..." : path).padEnd(25);
  const sizeBadge = colorize(formatBytes(event.sizeBytes).padStart(8), colors.dim);

  // 4. Resolve delivery status badge, latency, and error message
  let statusBadge = colorize("✓ RECEIVED", colors.dim);
  let latencyStr = "";
  let errorSuffix = "";

  if (delivery) {
    const code = delivery.statusCode;
    if (code >= 200 && code < 300) {
      statusBadge = colorize(`🟢 ${code} OK`, colors.brightGreen);
    } else if (code >= 300 && code < 400) {
      statusBadge = colorize(`🟡 ${code} REDIR`, colors.brightYellow);
    } else if (code >= 400 && code < 500) {
      statusBadge = colorize(`🟠 ${code} CLIENT_ERR`, colors.brightYellow);
    } else {
      statusBadge = colorize(`🔴 ${code} SERVER_ERR`, colors.brightRed);
    }

    latencyStr = colorize(`${delivery.latencyMs}ms`.padStart(8), colors.dim);

    if (code >= 500 && delivery.responseBody) {
      try {
        const parsed: unknown = JSON.parse(delivery.responseBody);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "message" in parsed &&
          typeof parsed.message === "string"
        ) {
          errorSuffix = ` ${colorize("➔", colors.dim)} ${colorize(parsed.message, colors.red)}`;
        }
      } catch {
        // Body is not JSON, ignore
      }
    }
  }

  // 5. Append short event UUID tag and assemble full line string
  const idBadge = colorize(`[${event.id.slice(0, 8)}]`, colors.dim);

  return `${time}  ${methodBadge} ${pathDisplay} ${sizeBadge} ${statusBadge} ${latencyStr}  ${idBadge}${errorSuffix}`;
};

/** Render the separate committed target result without implying the receipt itself succeeded. */
export const formatDeliveryResultLine = (result: AgentDeliveryStream): string => {
  const ok = result.statusCode >= 200 && result.statusCode < 300;
  const badge = colorize(
    `${ok ? "🟢" : "🔴"} ${result.statusCode || "NO RESPONSE"}`,
    ok ? colors.brightGreen : colors.brightRed,
  );
  const trigger = result.trigger === "replay" ? "REPLAY" : "TARGET";
  return `${colorize(formatTimestamp(), colors.dim)}  ↳ ${trigger} ${badge} ${result.latencyMs}ms [${result.deliveryId.slice(0, 8)}]`;
};

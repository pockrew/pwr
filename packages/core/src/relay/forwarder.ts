import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import {
  RelayHeadersSchema,
  RelayResultStatuses,
  type LocalEndpointCredential,
  type RelayClientAck,
  type RelayExecutionResult,
  type RelayPackage,
} from "@pockrew/pwr-shared/schemas";

/** Idempotency headers let targets dedupe at-least-once delivery; replays keep their source ID. */
export const PWR_DELIVERY_ID_HEADER = "x-pwr-delivery-id";
export const PWR_REPLAY_OF_HEADER = "x-pwr-replay-of";

/**
 * Forwards a server delivery verbatim to its agent-owned local target, bypassing all processors.
 * @param packet - Original bytes, headers and raw query received over relay.
 * @param target - Agent-owned target URL; the server never supplies it.
 * @param projectId - Local audit context; never sent to the target or server.
 * @param credential - Optional local header supplied by the agent; the engine never reads a DB.
 * @returns Local audit result (with response body) and an outcome-only relay/replay ACK.
 *   Network errors and corrupt local headers become FAILED results instead of throwing, so one
 *   bad package cannot stall the tunnel queue.
 */
export const forwardRelayPackage = async (
  packet: RelayPackage,
  target: string,
  projectId: string,
  credential?: LocalEndpointCredential | null,
): Promise<{ result: RelayExecutionResult; ack: RelayClientAck }> => {
  const start = performance.now();
  let request: { url: URL; body: Buffer; headers: Record<string, string> };
  try {
    request = buildTargetRequest(packet, target, credential);
  } catch {
    return outcome(packet, target, projectId, start, {
      body: "Stored request could not be forwarded: invalid target URL or header value",
    });
  }
  const response = await sendOnce(packet.method, request);
  return outcome(packet, request.url.toString(), projectId, start, response);
};

type TargetResponse = {
  status?: number;
  headers?: Record<string, string>;
  body: string;
  bytes?: number;
};

/** Rebuild the original request for a new connection; throws on corrupt URL or header values. */
const buildTargetRequest = (
  packet: RelayPackage,
  target: string,
  credential?: LocalEndpointCredential | null,
): { url: URL; body: Buffer; headers: Record<string, string> } => {
  // 1. Decode body directly; even GET/HEAD bodies must not be silently discarded by fetch.
  const body = Buffer.from(packet.payloadBase64, "base64");
  const url = new URL(target);
  // The target's own query (e.g. a token) stays; the provider's raw query follows it unchanged.
  if (packet.rawQuery)
    url.search = url.search ? `${url.search.slice(1)}&${packet.rawQuery}` : packet.rawQuery;
  const headers = new Headers(RelayHeadersSchema.parse(JSON.parse(packet.headers)));

  // 2. Rebuild only hop-by-hop transport headers for the new HTTP connection.
  const connectionHeaders = (headers.get("connection") ?? "").split(",");
  for (const name of [
    ...connectionHeaders,
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
  ]) {
    if (name.trim()) headers.delete(name.trim());
  }
  // 3. Legacy packets may contain the server's inbound key; only a local credential may set it.
  headers.delete("x-api-key");
  if (credential) headers.set(credential.headerName, credential.secret);
  headers.set(PWR_DELIVERY_ID_HEADER, packet.id);
  if (packet.replayOfDeliveryId) headers.set(PWR_REPLAY_OF_HEADER, packet.replayOfDeliveryId);
  headers.set("content-length", String(body.byteLength));
  return { url, body, headers: Object.fromEntries(headers) };
};

/**
 * Make exactly one request, without redirects, JSON rewriting or automatic local retries.
 * Settles on every exit path (response end/abort/close, request error/timeout).
 */
const sendOnce = (
  method: string,
  { url, body, headers }: { url: URL; body: Buffer; headers: Record<string, string> },
): Promise<TargetResponse> =>
  new Promise<TargetResponse>((resolve) => {
    let settled = false;
    const settle = (value: TargetResponse): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    let req: ReturnType<typeof httpRequest>;
    try {
      req = send(url, { method, headers, signal: AbortSignal.timeout(10_000) }, (res) => {
        // ponytail: keep at most 64 KiB of the response locally; the rest is counted and discarded.
        const chunks: Buffer[] = [];
        let remaining = 64 * 1024;
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (remaining > 0) {
            chunks.push(chunk.subarray(0, remaining));
            remaining -= chunk.byteLength;
          }
        });
        const finish = (interrupted: boolean): void => {
          const responseHeaders: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined)
              responseHeaders[name] = Array.isArray(value) ? value.join(", ") : value;
          }
          settle({
            ...(res.statusCode === undefined ? {} : { status: res.statusCode }),
            headers: responseHeaders,
            body: interrupted
              ? "Local target response interrupted"
              : Buffer.concat(chunks).toString("utf8"),
            bytes,
          });
        };
        res.on("end", () => finish(false));
        res.on("aborted", () => finish(true));
        res.on("error", () => finish(true));
        res.on("close", () => finish(!res.complete));
      });
    } catch {
      settle({ body: "Stored request could not be forwarded: invalid header value" });
      return;
    }
    req.on("error", () => settle({ body: "Local target request failed or timed out" }));
    req.on("close", () => settle({ body: "Local target closed the connection" }));
    req.end(body);
  });

/** Split one target response into the local audit result and the outcome-only upstream ACK. */
const outcome = (
  packet: RelayPackage,
  targetUrl: string,
  projectId: string,
  start: number,
  response: TargetResponse,
): { result: RelayExecutionResult; ack: RelayClientAck } => {
  // Keep the local secret/request headers out of audit results and upstream ACKs.
  const status =
    response.status !== undefined && response.status >= 200 && response.status < 300
      ? RelayResultStatuses.SUCCESS
      : RelayResultStatuses.FAILED;
  const latencyMs = Number((performance.now() - start).toFixed(2));
  // Only outcome metadata goes upstream; response content stays in the agent DB.
  const fields = {
    status,
    ...(response.status === undefined ? {} : { responseStatus: response.status }),
    latencyMs,
    ...(response.bytes === undefined ? {} : { responseBytes: response.bytes }),
  };
  const ack: RelayClientAck =
    packet.trigger === "replay" && packet.replayOfDeliveryId
      ? {
          type: "ack_replayed",
          deliveryId: packet.replayOfDeliveryId,
          replayId: packet.id,
          ...fields,
        }
      : { type: "ack_relayed", deliveryId: packet.id, ...fields };
  return {
    ack,
    result: {
      id: packet.id,
      webhookId: packet.eventId,
      tunnelId: packet.tunnelId,
      destinationId: packet.endpointId,
      orgId: "default",
      projectId,
      targetUrl,
      statusCode: response.status ?? 502,
      latencyMs,
      deliveredAt: Date.now(),
      ...(response.headers === undefined ? {} : { responseHeaders: response.headers }),
      responseBody: response.body,
    },
  };
};

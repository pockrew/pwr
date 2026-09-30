import type { ServerWebSocket } from "bun";
import { db } from "@server/db/client";
import {
  apiKeys,
  collections,
  endpoints,
  tunnels,
  webhookDeliveries,
  webhookEvents,
} from "@server/db/schemas";
import { ingressEvents } from "@server/modules/ingress/events";
import { withoutIngressApiKey } from "@server/modules/ingress/headers";
import {
  commitRelayResult,
  deferPreparation,
  DeliveryAckSchema,
  findDelivery,
  markDeliveryReceived,
  prepareDelivery,
} from "@server/modules/relays/delivery.service";
import { env } from "@server/platform/env";
import { log } from "@server/platform/logger.middleware";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  RELAY_CLOSE_TUNNEL_IN_USE,
  RelayHeadersSchema,
  type RelayResultConfirmation,
} from "@pockrew/pwr-shared/schemas";

export type IWsData = Record<string, unknown>;
export type IWsConnection = Pick<
  ServerWebSocket<IWsData>,
  "readyState" | "data" | "send" | "close" | "getBufferedAmount"
>;

type RelayConnection = {
  ws: IWsConnection;
  pending: Set<string>;
  receiptTimer: ReturnType<typeof setTimeout> | null;
  keyId: string | undefined;
  resultReceipts: boolean;
  acceptDeliveries: boolean;
  /** Stable agent instance ID; a reconnect from the same agent may replace its own socket. */
  agentId: string | undefined;
};

/** Options negotiated in the upgrade headers. */
export type RelayRegistration = {
  keyId?: string | undefined;
  resultReceipts?: boolean;
  acceptDeliveries?: boolean;
  agentId?: string | undefined;
  takeover?: boolean;
};

class RelayService {
  // ponytail: one active agent per tunnel; add competing consumers only when required.
  private readonly connections = new Map<string, RelayConnection>();

  /**
   * Revalidate the upgraded connection and replace the prior socket before pending sync.
   * @param tunnelId - Tunnel verified by the HTTP transport guard.
   * @param ws - Open socket receiving subscription and delivery frames.
   * @param keyId - Credential ID supplied by production routes; omitted by internal fixtures.
   * @returns Nothing; invalid auth closes with 1008, storage/socket failures with 1011.
   */
  public register = (
    tunnelId: string,
    ws: IWsConnection,
    {
      keyId,
      resultReceipts = false,
      acceptDeliveries = true,
      agentId,
      takeover = false,
    }: RelayRegistration = {},
  ): void => {
    try {
      // 1. A key can be revoked after HTTP authentication but before the upgrade opens.
      if (
        keyId &&
        !db
          .select({ id: apiKeys.id })
          .from(apiKeys)
          .innerJoin(tunnels, eq(apiKeys.tunnelId, tunnels.id))
          .where(
            and(
              eq(apiKeys.id, keyId),
              eq(apiKeys.tunnelId, tunnelId),
              eq(apiKeys.types, "outbound"),
              isNull(apiKeys.deletedAt),
              isNull(tunnels.deletedAt),
              eq(tunnels.isActive, true),
            ),
          )
          .get()
      ) {
        ws.close(1008, "Relay authorization revoked");
        return;
      }
      // 2. One active agent per tunnel. The same agent (reconnect over a half-open socket) may
      // replace itself; a different agent is rejected unless it explicitly asks to take over,
      // otherwise two machines would steal PENDING deliveries from each other and call targets
      // twice.
      const previous = this.connections.get(tunnelId);
      if (previous && previous.ws !== ws && !takeover && previous.agentId !== agentId) {
        ws.close(RELAY_CLOSE_TUNNEL_IN_USE, "Tunnel already has an active agent");
        return;
      }
      if (previous) this.unregister(tunnelId, previous.ws);
      this.connections.set(tunnelId, {
        ws,
        pending: new Set(),
        receiptTimer: null,
        keyId,
        resultReceipts,
        acceptDeliveries,
        agentId,
      });
      // A different agent that loses the tunnel gets the in-use code so it stops reconnecting
      // instead of grabbing the tunnel back on the new owner's next network blip.
      if (previous && previous.ws !== ws)
        previous.ws.close(
          previous.agentId === agentId ? 1000 : RELAY_CLOSE_TUNNEL_IN_USE,
          previous.agentId === agentId
            ? "Replaced by a new connection"
            : "Taken over by another agent",
        );
      // 3. Confirm subscription and begin bounded pending sync.
      if (ws.send(JSON.stringify({ type: "subscribed", tunnelId })) === 0) {
        throw new Error("Subscription frame dropped");
      }
      this.send(tunnelId, "sync");
    } catch {
      this.disconnect(tunnelId, ws, 1011, "Relay unavailable; reconnect to sync");
    }
  };

  public unregister = (tunnelId: string, ws: IWsConnection): void => {
    const connection = this.connections.get(tunnelId);
    // A delayed close from an older socket must not cancel the new connection's timer.
    if (connection?.ws !== ws) return;
    this.clearReceiptTimer(connection);
    this.connections.delete(tunnelId);
  };

  private clearReceiptTimer = (connection: RelayConnection): void => {
    if (connection.receiptTimer !== null) clearTimeout(connection.receiptTimer);
    connection.receiptTimer = null;
  };

  /**
   * One deadline covers the complete batch; partial ACKs do not extend it.
   * Closing only the socket preserves unacknowledged DB rows for reconnect,
   * while already received packages stay DELIVERED and are not sent again.
   */
  private waitForReceipts = (tunnelId: string, connection: RelayConnection): void => {
    this.clearReceiptTimer(connection);
    connection.receiptTimer = setTimeout(() => {
      if (this.connections.get(tunnelId) !== connection || connection.pending.size === 0) return;
      log.warn({ event: "relay.receipt_timeout", tunnelId, pending: connection.pending.size }, "");
      this.disconnect(
        tunnelId,
        connection.ws,
        1011,
        "Receipt ACK timeout; reconnect to sync pending",
      );
    }, env.RELAY_ACK_TIMEOUT_MS);
    // An active socket keeps the server alive; a deadline must not prolong shutdown.
    connection.receiptTimer.unref();
  };

  private disconnect = (tunnelId: string, ws: IWsConnection, code: number, reason: string) => {
    this.unregister(tunnelId, ws);
    ws.close(code, reason);
  };

  /** Send a bounded batch from the durable pending queue; only receipt ACKs release it. */
  public send = (tunnelId: string, type: "sync" | "webhook_event" = "webhook_event"): void => {
    const connection = this.connections.get(tunnelId);
    if (!connection || !connection.acceptDeliveries || connection.pending.size > 0) return;
    const { ws } = connection;
    try {
      if (ws.readyState !== 1 || ws.getBufferedAmount() > env.MAX_WS_BUFFER_BYTES) {
        throw new Error("Relay socket unavailable");
      }
      // Select IDs first: loading 50 BLOBs before applying a byte budget would still
      // allocate the entire backlog batch in memory (up to 250 MiB at default limits).
      const candidates = db
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
        .innerJoin(endpoints, eq(webhookDeliveries.endpointId, endpoints.id))
        .innerJoin(collections, eq(endpoints.collectionId, collections.id))
        .where(
          and(
            eq(webhookEvents.tunnelId, tunnelId),
            eq(collections.tunnelId, tunnelId),
            eq(webhookDeliveries.status, "PENDING"),
            eq(endpoints.isActive, true),
            eq(endpoints.isPaused, false),
            eq(collections.isActive, true),
            isNull(endpoints.deletedAt),
            isNull(collections.deletedAt),
          ),
        )
        // Insertion order: receivedAt has one-second precision and delivery IDs are random, so
        // they would shuffle events received within the same second.
        .orderBy(sql`${webhookEvents}.rowid`, sql`${webhookDeliveries}.rowid`)
        .limit(env.MAX_REPLAY_BACKLOG_BATCH)
        .all();
      const prefix =
        type === "sync" ? '{"type":"sync","deliveries":[' : '{"type":"webhook_event","events":[';
      const packages: string[] = [];
      let frameBytes = Buffer.byteLength(prefix) + 2; // Include the closing ]}.

      // ponytail: bounded primary-key reads against local SQLite; no payload-sized
      // backlog array. If much larger batch counts are needed, use a DB cursor.
      for (const candidate of candidates) {
        const row = db
          .select({ delivery: webhookDeliveries, event: webhookEvents })
          .from(webhookDeliveries)
          .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
          .innerJoin(endpoints, eq(webhookDeliveries.endpointId, endpoints.id))
          .where(and(eq(webhookDeliveries.id, candidate.id), eq(webhookEvents.tunnelId, tunnelId)))
          .get();
        if (!row) continue;
        const { delivery, event } = row;
        const encoded = JSON.stringify({
          ...delivery,
          tunnelId,
          method: event.method,
          contentType: event.contentType,
          payloadBase64: event.payload?.toString("base64") ?? "",
          // Older stored events may still contain the inbound transport key.
          headers: JSON.stringify(
            withoutIngressApiKey(RelayHeadersSchema.parse(JSON.parse(event.headers))),
          ),
          queryParams: event.queryParams,
          rawQuery: event.rawQuery,
          sourceIp: event.sourceIp,
          userAgent: event.userAgent,
          eventReceivedAt: event.receivedAt,
        });
        const packageBytes = Buffer.byteLength(encoded) + (packages.length > 0 ? 1 : 0);
        if (packages.length > 0 && frameBytes + packageBytes > env.MAX_REPLAY_BATCH_BYTES) break;
        packages.push(encoded);
        frameBytes += packageBytes;
        connection.pending.add(delivery.id);

        // A single valid ingress can exceed the batch budget after base64 encoding.
        // Send it alone so it neither blocks the queue nor gets split/truncated.
        if (frameBytes >= env.MAX_REPLAY_BATCH_BYTES) break;
      }
      if (packages.length === 0) return;
      // Serialize each package once. Byte accounting includes UTF-8, commas and envelope.
      const message = `${prefix}${packages.join(",")}]}`;
      this.waitForReceipts(tunnelId, connection);
      // Bun returns -1 when queued under backpressure, 0 when the frame was dropped.
      if (ws.send(message) === 0) throw new Error("Delivery frame dropped");
    } catch {
      log.warn({ event: "relay.send_failed", tunnelId }, "");
      this.disconnect(tunnelId, ws, 1011, "Relay unavailable; reconnect to sync");
    }
  };

  /**
   * Receipt ACKs release the current batch and cancel its deadline when complete.
   * Relay/replay results are independent: they never renew the receipt deadline.
   * Current-socket and tunnel checks also protect reconnects from delayed ACKs.
   */
  public acknowledge = (tunnelId: string, ws: IWsConnection, data: unknown): void => {
    const connection = this.connections.get(tunnelId);
    if (connection?.ws !== ws) return;
    if (typeof data !== "string" || Buffer.byteLength(data) > 2 * 1024 * 1024) {
      this.disconnect(tunnelId, ws, 1008, "Invalid ACK frame");
      return;
    }
    try {
      const ack = DeliveryAckSchema.parse(JSON.parse(data));
      if (ack.type === "ack_received") {
        if (!connection.pending.has(ack.deliveryId)) {
          // A persisted receipt may be retried on a report-only reconnect after its frame was lost.
          // Scope-check before updating; no current batch is released by this older receipt.
          const saved = findDelivery(tunnelId, ack.deliveryId);
          if (!saved) return;
          markDeliveryReceived(tunnelId, ack.deliveryId);
          if (saved.relayStatus) this.confirmResult(connection, ack.deliveryId, "receipt");
          return;
        }
        markDeliveryReceived(tunnelId, ack.deliveryId);
        connection.pending.delete(ack.deliveryId);
        // A recovered terminal package can have a server result but no local result ACK.
        if (findDelivery(tunnelId, ack.deliveryId)?.relayStatus)
          this.confirmResult(connection, ack.deliveryId, "receipt");
        if (connection.pending.size === 0) {
          this.clearReceiptTimer(connection);
          this.send(tunnelId, "sync");
        }
        return;
      }
      // Results may arrive after receipt ACK or on a later authenticated connection.
      const source = findDelivery(tunnelId, ack.deliveryId);
      if (!source) {
        // Pruned by retention (or never on this tunnel): it can never be committed, so confirm it
        // anyway; otherwise the agent re-sends it forever and can never prune its local copy.
        log.warn({ event: "relay.result_source_missing", tunnelId }, "");
        this.confirmResult(connection, ack.type === "ack_replayed" ? ack.replayId : ack.deliveryId);
        return;
      }
      if (!connection.pending.has(source.id) && source.status !== "DELIVERED") return;
      const resultId = commitRelayResult(tunnelId, ack);
      // Commit returns only after SQLite succeeds. A dropped confirmation is safely retried.
      this.confirmResult(connection, resultId);
    } catch (error) {
      const invalid =
        error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError");
      this.disconnect(
        tunnelId,
        ws,
        invalid ? 1008 : 1011,
        "ACK rejected; reconnect to sync pending deliveries",
      );
    }
  };

  /** Opt-in preserves older agents which reject unknown server frames. Send failures reconnect. */
  private confirmResult = (
    connection: RelayConnection,
    resultId: string,
    source: RelayResultConfirmation["source"] = "result",
  ): void => {
    if (
      connection.resultReceipts &&
      connection.ws.send(
        JSON.stringify({
          type: "result_committed",
          resultId,
          source,
        } satisfies RelayResultConfirmation),
      ) === 0
    )
      throw new Error("Result confirmation dropped");
  };

  /**
   * Stop an existing relay after tunnel disable/delete or credential revocation.
   * @param tunnelId - Affected tunnel.
   * @param reason - Public reason sent in the close frame.
   * @param keyId - When present, leave sockets authenticated with other keys untouched.
   * @returns Nothing; unreceived packages remain pending for an authorized reconnect.
   */
  public closeTunnel = (tunnelId: string, reason: string, keyId?: string): void => {
    const connection = this.connections.get(tunnelId);
    if (!connection || (keyId !== undefined && connection.keyId !== keyId)) return;
    this.disconnect(tunnelId, connection.ws, 1008, reason);
  };

  public closeAll = (reason: string): void => {
    // Clear deadlines before closing sockets or shutting down the database.
    for (const [tunnelId, { ws }] of this.connections) {
      this.unregister(tunnelId, ws);
      ws.close(1001, reason);
    }
  };
}

export const relayService = new RelayService();

ingressEvents.on("stored", (eventId) => {
  queueMicrotask(() => {
    try {
      const tunnelId = prepareDelivery(eventId);
      if (tunnelId) relayService.send(tunnelId);
    } catch {
      // Keep the stored event unprepared so recovery can retry, even with no agent, but back it
      // off so it cannot starve the events behind it.
      log.warn({ event: "delivery.prepare_failed", eventId }, "");
      try {
        deferPreparation(eventId);
      } catch {
        // Recovery retries on the next pass without backoff.
      }
    }
  });
});

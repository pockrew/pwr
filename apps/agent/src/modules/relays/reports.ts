import {
  RelayClientAckSchema,
  type RelayClientAck,
  type RelayScope,
} from "@pockrew/pwr-shared/schemas";

import { relayReports } from "./repository";

const flushing = new WeakSet<WebSocket>();

/** Repeat durable receipt before its result so report-only reconnects recover a lost receipt frame. */
export const sendRelayReport = (ws: WebSocket, ack: RelayClientAck): void => {
  if (ack.type !== "ack_received")
    ws.send(
      JSON.stringify({ type: "ack_received", deliveryId: ack.deliveryId } satisfies RelayClientAck),
    );
  ws.send(JSON.stringify(ack));
};

/**
 * Retry unconfirmed results in insertion order on reconnect and periodic maintenance.
 * @param current - Stops a pass when the authenticated socket is replaced.
 * @throws On read/send failure; caller closes the socket, leaving persisted reports available.
 */
export const flushRelayReports = async (
  scope: RelayScope,
  ws: WebSocket,
  current: () => boolean,
): Promise<void> => {
  if (flushing.has(ws)) return;
  flushing.add(ws);
  try {
    let cursor = 0;
    while (current() && ws.readyState === WebSocket.OPEN) {
      const reports = relayReports(scope, cursor, true);
      if (reports.length === 0) break;
      for (const report of reports) {
        // 1. Bound the send buffer; no payload BLOBs are loaded by this report query.
        while (current() && ws.readyState === WebSocket.OPEN && ws.bufferedAmount > 1024 * 1024)
          await Bun.sleep(10);
        if (!current() || ws.readyState !== WebSocket.OPEN) return;
        sendRelayReport(ws, RelayClientAckSchema.parse(JSON.parse(report.ack)));
        cursor = report.sequence;
      }
      // 2. Keep exact ACKs until result_committed is persisted, including parent/child retries.
      await Bun.sleep(0);
    }
  } finally {
    flushing.delete(ws);
  }
};

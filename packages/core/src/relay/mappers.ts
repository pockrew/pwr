import {
  RelayHeadersSchema,
  RelayMetadataSchema,
  type RelayPackage,
  type WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

/** Query parameters from the original query string; repeated keys keep every value. */
const queryRecord = (rawQuery: string | null): Record<string, string> | undefined => {
  if (!rawQuery) return undefined;
  const record: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(rawQuery))
    record[key] = key in record ? `${record[key]}, ${value}` : value;
  return record;
};

/**
 * Maps relay input to the existing local event contract without interpreting provider bytes.
 * The target outcome is not known yet; it comes from the event's deliveries.
 * @param packet - Validated server delivery.
 * @param projectId - Local display scope.
 * @returns Event referencing the original base64 bytes; throws on malformed headers.
 */
export const relayPacketToEvent = (packet: RelayPackage, projectId: string): WebhookEvent => ({
  id: packet.eventId,
  tunnelId: packet.tunnelId,
  orgId: "default",
  projectId,
  method: packet.method,
  headers: RelayHeadersSchema.parse(JSON.parse(packet.headers)),
  queryParams: queryRecord(packet.rawQuery),
  rawPayloadBase64: packet.payloadBase64,
  isBinary: true,
  createdAt: Date.parse(packet.eventReceivedAt),
});

/**
 * Creates metadata for an independent replay using the same event/endpoint identity.
 * @param source - Stored source package; its body is never copied into metadata.
 * @param id - Fresh replay UUID generated before execution.
 * @returns Replay metadata; throws when the source is malformed.
 */
export const replayMetadata = (source: RelayPackage, id: string) =>
  RelayMetadataSchema.parse({
    ...source,
    id,
    trigger: "replay",
    replayOfDeliveryId: source.id,
    relayStatus: null,
  });

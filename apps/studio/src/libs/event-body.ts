import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const CHUNK = 0x8000;

/** One character per byte (exact for 0x00–0xFF), so the inspector renders a faithful hex dump. */
const byteString = (bytes: Uint8Array): string => {
  let text = "";
  for (let start = 0; start < bytes.length; start += CHUNK)
    text += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  return text;
};

/**
 * The event with `body` filled for display from its original bytes: UTF-8 text when valid,
 * otherwise one character per byte so binary payloads show as a hex dump. The stored bytes are
 * untouched; replay always sends them as received.
 */
export const withDecodedBody = (event: WebhookEvent): WebhookEvent => {
  if (event.body !== undefined) return event;
  if (event.payloadText !== undefined) return { ...event, body: event.payloadText };
  if (!event.rawPayloadBase64) return event;
  const bytes = Uint8Array.from(atob(event.rawPayloadBase64), (char) => char.charCodeAt(0));
  try {
    return { ...event, body: utf8.decode(bytes) };
  } catch {
    return { ...event, body: byteString(bytes) };
  }
};

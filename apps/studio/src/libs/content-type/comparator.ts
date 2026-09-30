import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

import { detectPayload, extractMimeType } from "./detector";
import type { EventComparisonResult } from "./types";

/**
 * Extracts and normalizes the MIME content-type of an event header or payload sniffing.
 *
 * @param event - The WebhookEvent object to inspect.
 * @returns Normalized MIME type or detected format string.
 */
export const getEventContentType = (event?: WebhookEvent | null): string => {
  // 1. Early return if event is undefined
  if (!event) {
    return "";
  }

  // 2. Extract from headers if defined
  const headers = event.headers;
  if (headers) {
    const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type");
    if (entry && typeof entry[1] === "string") {
      const mime = extractMimeType(entry[1]);
      if (mime) {
        return mime;
      }
    }
  }

  // 3. Fallback to sniffing payload body
  const detected = detectPayload(event.body, "");
  return detected.mimeType || detected.format;
};

/**
 * Validates whether two webhook events are compatible for side-by-side diff comparison.
 *
 * @param eventA - The base WebhookEvent.
 * @param eventB - The target WebhookEvent.
 * @returns EventComparisonResult with comparison eligibility and details.
 */
export const areEventsComparable = (
  eventA?: WebhookEvent | null,
  eventB?: WebhookEvent | null,
): EventComparisonResult => {
  // 1. Validate both events exist
  if (!eventA || !eventB) {
    return { comparable: false, reason: "Missing event for comparison" };
  }

  // 2. Detect payload formats for both events
  const headerA = Object.entries(eventA.headers ?? {}).find(
    ([k]) => k.toLowerCase() === "content-type",
  )?.[1];
  const headerB = Object.entries(eventB.headers ?? {}).find(
    ([k]) => k.toLowerCase() === "content-type",
  )?.[1];

  const payloadA = detectPayload(eventA.body, headerA);
  const payloadB = detectPayload(eventB.body, headerB);

  const typeA = payloadA.mimeType || payloadA.format;
  const typeB = payloadB.mimeType || payloadB.format;

  // 3. Verify format or exact MIME compatibility
  const isMatch = payloadA.format === payloadB.format || typeA === typeB;

  if (!isMatch) {
    return {
      comparable: false,
      reason: `Cannot compare requests with different content types (${payloadA.label} vs ${payloadB.label})`,
      typeA: payloadA.label,
      typeB: payloadB.label,
      formatA: payloadA.format,
      formatB: payloadB.format,
    };
  }

  return {
    comparable: true,
    typeA: payloadA.label,
    typeB: payloadB.label,
    formatA: payloadA.format,
    formatB: payloadB.format,
  };
};

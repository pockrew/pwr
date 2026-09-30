/// <reference types="bun" />
import { expect, test } from "bun:test";

import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

import { withDecodedBody } from "./event-body";

const createTestEvent = (overrides: Partial<WebhookEvent> = {}): WebhookEvent => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  tunnelId: "tunnel-1",
  orgId: "default",
  projectId: "default",
  method: "POST",
  headers: {},
  createdAt: Date.now(),
  ...overrides,
});

test("UTF-8 JSON payload with multi-byte characters base64-encoded decodes to original string", () => {
  const originalText = '{"message":"ünïcode ✓"}';
  const base64 = Buffer.from(originalText).toString("base64");
  const originalBase64 = base64;

  const event = createTestEvent({ rawPayloadBase64: base64 });
  const result = withDecodedBody(event);

  expect(result.body).toBe(originalText);
  expect(result.rawPayloadBase64).toBe(originalBase64);
});

test("Invalid UTF-8 binary payload decodes to byte-string with exact byte mapping", () => {
  const bytes = new Uint8Array([0x00, 0xff, 0x0d, 0x0a, 0x80, 0x9f, 0xc3, 0x28]);
  const base64 = Buffer.from(bytes).toString("base64");
  const originalBase64 = base64;

  const event = createTestEvent({ rawPayloadBase64: base64 });
  const result = withDecodedBody(event);

  expect(result.body).toBeDefined();
  expect(result.body!.length).toBe(8);

  const resultBytes = [...result.body!].map((c) => c.charCodeAt(0));
  expect(resultBytes).toEqual([0x00, 0xff, 0x0d, 0x0a, 0x80, 0x9f, 0xc3, 0x28]);
  expect(result.rawPayloadBase64).toBe(originalBase64);
});

test("Large invalid UTF-8 binary payload decodes without throwing and round-trips byte-for-byte", () => {
  const largeBytes = new Uint8Array(100_000);
  for (let i = 0; i < largeBytes.length; i++) {
    largeBytes[i] = i % 256;
  }
  const base64 = Buffer.from(largeBytes).toString("base64");

  const event = createTestEvent({ rawPayloadBase64: base64 });
  const result = withDecodedBody(event);

  expect(result.body).toBeDefined();
  expect(result.body!.length).toBe(100_000);

  const resultBytes = [...result.body!].map((c) => c.charCodeAt(0));
  for (let i = 0; i < 100_000; i++) {
    expect(resultBytes[i]).toBe(i % 256);
  }
});

test("payloadText present and body absent sets body to payloadText", () => {
  const payloadText = '{"data":"test"}';
  const event = createTestEvent({ payloadText });

  const result = withDecodedBody(event);

  expect(result.body).toBe(payloadText);
});

test("body already present returns the same object (toBe reference equality)", () => {
  const event = createTestEvent({ body: "existing body" });

  const result = withDecodedBody(event);

  expect(result).toBe(event);
});

test("no body, no payloadText, no rawPayloadBase64 returns unchanged", () => {
  const event = createTestEvent();

  const result = withDecodedBody(event);

  expect(result).toBe(event);
});

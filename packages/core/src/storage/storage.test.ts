import { describe, expect, it } from "bun:test";

import type { WebhookDelivery, WebhookEvent } from "@pockrew/pwr-shared/schemas";

import {
  fromStoredDelivery,
  fromStoredWebhook,
  toStoredDelivery,
  toStoredWebhook,
} from "./converters";

describe("Core Storage Converters", () => {
  it("converts WebhookEvent to stored record and back losslessly", () => {
    const event: WebhookEvent = {
      id: "00000000-0000-0000-0000-000000000001",
      tunnelId: "tun_123",
      orgId: "org_alpha",
      projectId: "proj_beta",
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": "sig_abc" },
      queryParams: { branch: "main" },
      body: '{"ref":"main"}',
      status: 200,
      executionTimeMs: 12,
      createdAt: 1700000000000,
    };

    const stored = toStoredWebhook(event);
    expect(stored.id).toBe(event.id);
    expect(typeof stored.headers).toBe("string");
    expect(typeof stored.queryParams).toBe("string");

    const reconstituted = fromStoredWebhook(stored);
    expect(reconstituted.id).toBe(event.id);
    expect(reconstituted.method).toBe("POST");
    expect(reconstituted.headers["content-type"]).toBe("application/json");
    expect(reconstituted.headers["x-signature"]).toBe("sig_abc");
    expect(reconstituted.queryParams?.["branch"]).toBe("main");
    expect(reconstituted.body).toBe('{"ref":"main"}');
    expect(reconstituted.createdAt).toBe(1700000000000);
  });

  it("converts WebhookDelivery to stored record and back losslessly", () => {
    const delivery: WebhookDelivery = {
      webhookId: "00000000-0000-0000-0000-000000000001",
      tunnelId: "tun_123",
      orgId: "org_alpha",
      projectId: "proj_beta",
      targetUrl: "http://localhost:3000/api",
      statusCode: 200,
      latencyMs: 25,
      responseHeaders: { "x-ack": "true" },
      responseBody: "success",
      deliveredAt: 1700000000025,
    };

    const stored = toStoredDelivery(delivery);
    expect(stored.webhookId).toBe(delivery.webhookId);
    expect(stored.targetUrl).toBe("http://localhost:3000/api");

    const reconstituted = fromStoredDelivery(stored);
    expect(reconstituted.webhookId).toBe(delivery.webhookId);
    expect(reconstituted.statusCode).toBe(200);
    expect(reconstituted.latencyMs).toBe(25);
    expect(reconstituted.responseHeaders?.["x-ack"]).toBe("true");
    expect(reconstituted.responseBody).toBe("success");
    expect(reconstituted.deliveredAt).toBe(1700000000025);
  });

  it("converts binary WebhookEvent with SSOT payload BLOB and preserves bytes exactly", () => {
    const rawBytes = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x12, 0x34]);
    const base64 = Buffer.from(rawBytes).toString("base64");

    const event: WebhookEvent = {
      id: "00000000-0000-0000-0000-000000000002",
      tunnelId: "tun_bin_123",
      orgId: "org_alpha",
      projectId: "proj_beta",
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      rawPayloadBase64: base64,
      isBinary: true,
      status: 200,
      executionTimeMs: 4,
      createdAt: 1700000000100,
    };

    const stored = toStoredWebhook(event);
    expect(stored.isBinary).toBe(1);
    expect(stored.payload).not.toBeNull();
    expect(Array.from(stored.payload ?? [])).toEqual(Array.from(rawBytes));
    expect(stored.payloadText).toBeNull();

    const reconstituted = fromStoredWebhook(stored);
    expect(reconstituted.isBinary).toBe(true);
    expect(reconstituted.rawPayloadBase64).toBe(base64);
    expect(reconstituted.payloadText).toBeUndefined();
  });

  it("converts WebhookEvent with url, sizeBytes, attempts, replayCount and delivery requestHeaders/requestBody", () => {
    const event: WebhookEvent = {
      id: "00000000-0000-0000-0000-000000000003",
      tunnelId: "tun_new_fields",
      orgId: "org_alpha",
      projectId: "proj_beta",
      method: "POST",
      url: "http://localhost:3000/tun_new_fields/v1/payments",
      headers: { "content-type": "application/json" },
      body: '{"amount":100}',
      sizeBytes: 14,
      attempts: 3,
      replayCount: 2,
      status: 200,
      executionTimeMs: 15,
      createdAt: 1700000000200,
    };

    const stored = toStoredWebhook(event);
    expect(stored.url).toBe("http://localhost:3000/tun_new_fields/v1/payments");
    expect(stored.sizeBytes).toBe(14);
    expect(stored.attempts).toBe(3);
    expect(stored.replayCount).toBe(2);

    const reconstituted = fromStoredWebhook(stored);
    expect(reconstituted.url).toBe("http://localhost:3000/tun_new_fields/v1/payments");
    expect(reconstituted.sizeBytes).toBe(14);
    expect(reconstituted.attempts).toBe(3);
    expect(reconstituted.replayCount).toBe(2);

    const delivery: WebhookDelivery = {
      webhookId: event.id,
      tunnelId: event.tunnelId,
      orgId: event.orgId,
      projectId: event.projectId,
      targetUrl: "http://localhost:4000/payments",
      statusCode: 200,
      latencyMs: 10,
      requestHeaders: { "content-type": "application/json", "x-request-id": "req-1" },
      requestBody: '{"amount":100}',
      responseHeaders: { "x-response": "ok" },
      responseBody: '{"success":true}',
      deliveredAt: 1700000000210,
    };

    const storedDelivery = toStoredDelivery(delivery);
    expect(storedDelivery.requestHeaders).toBe(JSON.stringify(delivery.requestHeaders));
    expect(storedDelivery.requestBody).toBe('{"amount":100}');

    const reconstitutedDelivery = fromStoredDelivery(storedDelivery);
    expect(reconstitutedDelivery.requestHeaders?.["x-request-id"]).toBe("req-1");
    expect(reconstitutedDelivery.requestBody).toBe('{"amount":100}');
  });
});

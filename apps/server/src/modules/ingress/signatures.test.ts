import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { SIGNATURE_TOLERANCE_SECONDS, SIGNATURE_VERIFIERS } from "./signatures";

// Helper: compute HMAC independently
const computeHmac = (
  algorithm: string,
  secret: string | Buffer,
  ...parts: (string | Uint8Array)[]
): Buffer => {
  const mac = createHmac(algorithm, secret);
  for (const part of parts) {
    mac.update(part);
  }
  return mac.digest();
};

describe("SIGNATURE_VERIFIERS", () => {
  describe("github", () => {
    const provider = "github";
    const secret = "my-secret";
    const body = new TextEncoder().encode("webhook payload");

    test("valid signature", () => {
      const expected = computeHmac("sha256", secret, body);
      const headers = new Headers({
        "x-hub-signature-256": `sha256=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(true);
    });

    test("binary body", () => {
      const binaryBody = new Uint8Array([0x00, 0xff, 0x0d, 0x0a]);
      const expected = computeHmac("sha256", secret, binaryBody);
      const headers = new Headers({
        "x-hub-signature-256": `sha256=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body: binaryBody,
        now: 0,
        options: null,
      });
      expect(result).toBe(true);
    });

    test("body changed by one byte", () => {
      const expected = computeHmac("sha256", secret, body);
      const headers = new Headers({
        "x-hub-signature-256": `sha256=${expected.toString("hex")}`,
      });
      const alteredBody = new Uint8Array(body);
      alteredBody[0] = (alteredBody[0]! + 1) % 256;
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body: alteredBody,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("wrong secret", () => {
      const expected = computeHmac("sha256", secret, body);
      const headers = new Headers({
        "x-hub-signature-256": `sha256=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret: "wrong-secret",
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("missing header", () => {
      const headers = new Headers({});
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("malformed header: non-hex garbage", () => {
      const headers = new Headers({
        "x-hub-signature-256": "sha256=not-hex-garbage-xyz",
      });
      expect(() =>
        SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now: 0, options: null }),
      ).not.toThrow();
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("malformed header: wrong prefix", () => {
      const expected = computeHmac("sha256", secret, body);
      const headers = new Headers({
        "x-hub-signature-256": `sha1=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("malformed header: wrong length hex", () => {
      const expected = computeHmac("sha256", secret, body);
      const hex = expected.toString("hex");
      const truncated = hex.slice(0, -2);
      const headers = new Headers({
        "x-hub-signature-256": `sha256=${truncated}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });
  });

  describe("stripe", () => {
    const provider = "stripe";
    const secret = "sk_test_secret";
    const body = new TextEncoder().encode('{"id": "evt_123"}');
    const now = 1234567890;
    const timestamp = now.toString();

    test("valid signature", () => {
      const expected = computeHmac("sha256", secret, `${timestamp}.`, body);
      const headers = new Headers({
        "stripe-signature": `t=${timestamp},v1=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("wrong secret", () => {
      const expected = computeHmac("sha256", secret, `${timestamp}.`, body);
      const headers = new Headers({
        "stripe-signature": `t=${timestamp},v1=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret: "wrong-secret",
        headers,
        body,
        now,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("missing header", () => {
      const headers = new Headers({});
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("body changed", () => {
      const expected = computeHmac("sha256", secret, `${timestamp}.`, body);
      const headers = new Headers({
        "stripe-signature": `t=${timestamp},v1=${expected.toString("hex")}`,
      });
      const alteredBody = new Uint8Array(body);
      alteredBody[0] = (alteredBody[0]! + 1) % 256;
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body: alteredBody,
        now,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("timestamp too old (>300s)", () => {
      const oldTimestamp = (now - SIGNATURE_TOLERANCE_SECONDS - 1).toString();
      const expected = computeHmac("sha256", secret, `${oldTimestamp}.`, body);
      const headers = new Headers({
        "stripe-signature": `t=${oldTimestamp},v1=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("timestamp at edge (exactly 300s old)", () => {
      const oldTimestamp = (now - SIGNATURE_TOLERANCE_SECONDS).toString();
      const expected = computeHmac("sha256", secret, `${oldTimestamp}.`, body);
      const headers = new Headers({
        "stripe-signature": `t=${oldTimestamp},v1=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("timestamp in future within window", () => {
      const futureTimestamp = (now + 100).toString();
      const expected = computeHmac("sha256", secret, `${futureTimestamp}.`, body);
      const headers = new Headers({
        "stripe-signature": `t=${futureTimestamp},v1=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("non-numeric timestamp", () => {
      const headers = new Headers({
        "stripe-signature": "t=abc,v1=deadbeef",
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("two t= entries (invalid)", () => {
      const headers = new Headers({
        "stripe-signature": `t=${timestamp},t=${timestamp},v1=abc123def456`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("multiple v1 entries, second one matches", () => {
      const expected1 = computeHmac("sha256", "other-secret", `${timestamp}.`, body);
      const expected2 = computeHmac("sha256", secret, `${timestamp}.`, body);
      const headers = new Headers({
        "stripe-signature": `t=${timestamp},v1=${expected1.toString("hex")},v1=${expected2.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("malformed v1 value (non-hex)", () => {
      const headers = new Headers({
        "stripe-signature": `t=${timestamp},v1=not-hex-garbage`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });
  });

  describe("standard_webhooks", () => {
    const provider = "standard_webhooks";
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
    const timestamp = "1614265330";
    const body = new TextEncoder().encode('{"test": 2432232314}');
    const now = parseInt(timestamp, 10);

    test("valid signature (test vector)", () => {
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
      const expected = computeHmac("sha256", key, `${id}.${timestamp}.`, body);
      const expectedBase64 = expected.toString("base64");
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${expectedBase64}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("published test vector verification", () => {
      // This is the published Standard Webhooks test vector
      const expectedSignature = "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${expectedSignature}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("svix- header names work", () => {
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
      const expected = computeHmac("sha256", key, `${id}.${timestamp}.`, body);
      const headers = new Headers({
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${expected.toString("base64")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("wrong secret", () => {
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
      const expected = computeHmac("sha256", key, `${id}.${timestamp}.`, body);
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${expected.toString("base64")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret: "whsec_wrongsecret123456789012345678901",
        headers,
        body,
        now,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("body changed", () => {
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
      const expected = computeHmac("sha256", key, `${id}.${timestamp}.`, body);
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${expected.toString("base64")}`,
      });
      const alteredBody = new Uint8Array(body);
      alteredBody[0] = (alteredBody[0]! + 1) % 256;
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body: alteredBody,
        now,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("missing id header", () => {
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
      const expected = computeHmac("sha256", key, `${id}.${timestamp}.`, body);
      const headers = new Headers({
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${expected.toString("base64")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("missing signature header", () => {
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("timestamp too old", () => {
      const oldTimestamp = (now - SIGNATURE_TOLERANCE_SECONDS - 1).toString();
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
      const expected = computeHmac("sha256", key, `${id}.${oldTimestamp}.`, body);
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": oldTimestamp,
        "webhook-signature": `v1,${expected.toString("base64")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("timestamp at edge (exactly 300s old)", () => {
      const oldTimestamp = (now - SIGNATURE_TOLERANCE_SECONDS).toString();
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
      const expected = computeHmac("sha256", key, `${id}.${oldTimestamp}.`, body);
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": oldTimestamp,
        "webhook-signature": `v1,${expected.toString("base64")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("non-numeric timestamp", () => {
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": "not-a-number",
        "webhook-signature": "v1,abc123",
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("multiple signature entries, second matches", () => {
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
      const wrongExpected = computeHmac("sha256", "wrong-key", `${id}.${timestamp}.`, body);
      const correctExpected = computeHmac("sha256", key, `${id}.${timestamp}.`, body);
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${wrongExpected.toString("base64")} v1,${correctExpected.toString("base64")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("malformed base64 in signature", () => {
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": "v1,not-valid-base64-!!!",
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("invalid secret (no base64 part)", () => {
      const headers = new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": "v1,abc123",
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret: "whsec_",
        headers,
        body,
        now,
        options: null,
      });
      expect(result).toBe(false);
    });
  });

  describe("shopify", () => {
    const provider = "shopify";
    const secret = "my-shopify-secret";
    const body = new TextEncoder().encode('{"id": 123456}');

    test("valid signature", () => {
      const expected = computeHmac("sha256", secret, body);
      const headers = new Headers({
        "x-shopify-hmac-sha256": expected.toString("base64"),
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(true);
    });

    test("body changed", () => {
      const expected = computeHmac("sha256", secret, body);
      const headers = new Headers({
        "x-shopify-hmac-sha256": expected.toString("base64"),
      });
      const alteredBody = new Uint8Array(body);
      alteredBody[0] = (alteredBody[0]! + 1) % 256;
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body: alteredBody,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("wrong secret", () => {
      const expected = computeHmac("sha256", secret, body);
      const headers = new Headers({
        "x-shopify-hmac-sha256": expected.toString("base64"),
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret: "wrong-secret",
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("missing header", () => {
      const headers = new Headers({});
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("malformed base64", () => {
      const headers = new Headers({
        "x-shopify-hmac-sha256": "not-valid-base64-!!!",
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("wrong length base64", () => {
      const expected = computeHmac("sha256", secret, body);
      const base64 = expected.toString("base64").slice(0, -2);
      const headers = new Headers({
        "x-shopify-hmac-sha256": base64,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });
  });

  describe("slack", () => {
    const provider = "slack";
    const secret = "8f742231b10e8888abcd99yyyzzz85a5";
    const timestamp = "1531420618";
    const body = new TextEncoder().encode(
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c",
    );
    const now = parseInt(timestamp, 10);

    test("published test vector verification", () => {
      // Slack's published example
      const expectedSignature = "a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503";
      const headers = new Headers({
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${expectedSignature}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("valid signature (computed)", () => {
      const expected = computeHmac("sha256", secret, `v0:${timestamp}:`, body);
      const headers = new Headers({
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("body changed", () => {
      const expected = computeHmac("sha256", secret, `v0:${timestamp}:`, body);
      const headers = new Headers({
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${expected.toString("hex")}`,
      });
      const alteredBody = new Uint8Array(body);
      alteredBody[0] = (alteredBody[0]! + 1) % 256;
      const result = SIGNATURE_VERIFIERS[provider]({
        secret,
        headers,
        body: alteredBody,
        now,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("wrong secret", () => {
      const expected = computeHmac("sha256", secret, `v0:${timestamp}:`, body);
      const headers = new Headers({
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({
        secret: "wrong-secret",
        headers,
        body,
        now,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("missing timestamp header", () => {
      const headers = new Headers({
        "x-slack-signature": "v0=abc123",
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("missing signature header", () => {
      const headers = new Headers({
        "x-slack-request-timestamp": timestamp,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("timestamp too old", () => {
      const oldTimestamp = (now - SIGNATURE_TOLERANCE_SECONDS - 1).toString();
      const expected = computeHmac("sha256", secret, `v0:${oldTimestamp}:`, body);
      const headers = new Headers({
        "x-slack-request-timestamp": oldTimestamp,
        "x-slack-signature": `v0=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("timestamp at edge (exactly 300s old)", () => {
      const oldTimestamp = (now - SIGNATURE_TOLERANCE_SECONDS).toString();
      const expected = computeHmac("sha256", secret, `v0:${oldTimestamp}:`, body);
      const headers = new Headers({
        "x-slack-request-timestamp": oldTimestamp,
        "x-slack-signature": `v0=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(true);
    });

    test("non-numeric timestamp", () => {
      const headers = new Headers({
        "x-slack-request-timestamp": "not-a-timestamp",
        "x-slack-signature": "v0=abc123",
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("malformed signature (non-hex)", () => {
      const headers = new Headers({
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": "v0=not-hex-garbage-xyz",
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });

    test("malformed signature (wrong prefix)", () => {
      const expected = computeHmac("sha256", secret, `v0:${timestamp}:`, body);
      const headers = new Headers({
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v1=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS[provider]({ secret, headers, body, now, options: null });
      expect(result).toBe(false);
    });
  });

  describe("hmac (generic)", () => {
    const body = new TextEncoder().encode("generic webhook payload");

    test("null options returns false", () => {
      const headers = new Headers({});
      const result = SIGNATURE_VERIFIERS.hmac({
        secret: "any-secret",
        headers,
        body,
        now: 0,
        options: null,
      });
      expect(result).toBe(false);
    });

    test("linear style (sha256, hex, no prefix)", () => {
      const secret = "linear-secret";
      const expected = computeHmac("sha256", secret, body);
      const options = {
        header: "linear-signature",
        algorithm: "sha256" as const,
        encoding: "hex" as const,
        prefix: "",
      };
      const headers = new Headers({
        "linear-signature": expected.toString("hex"),
      });
      const result = SIGNATURE_VERIFIERS.hmac({
        secret,
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(true);
    });

    test("intercom style (sha1, hex, sha1= prefix)", () => {
      const secret = "intercom-secret";
      const expected = computeHmac("sha1", secret, body);
      const options = {
        header: "x-hub-signature",
        algorithm: "sha1" as const,
        encoding: "hex" as const,
        prefix: "sha1=",
      };
      const headers = new Headers({
        "x-hub-signature": `sha1=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS.hmac({
        secret,
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(true);
    });

    test("typeform style (sha256, base64, sha256= prefix)", () => {
      const secret = "typeform-secret";
      const expected = computeHmac("sha256", secret, body);
      const options = {
        header: "typeform-signature",
        algorithm: "sha256" as const,
        encoding: "base64" as const,
        prefix: "sha256=",
      };
      const headers = new Headers({
        "typeform-signature": `sha256=${expected.toString("base64")}`,
      });
      const result = SIGNATURE_VERIFIERS.hmac({
        secret,
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(true);
    });

    test("sha512 with hex encoding", () => {
      const secret = "sha512-secret";
      const expected = computeHmac("sha512", secret, body);
      const options = {
        header: "x-signature",
        algorithm: "sha512" as const,
        encoding: "hex" as const,
        prefix: "sha512=",
      };
      const headers = new Headers({
        "x-signature": `sha512=${expected.toString("hex")}`,
      });
      const result = SIGNATURE_VERIFIERS.hmac({
        secret,
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(true);
    });

    test("body changed", () => {
      const secret = "test-secret";
      const expected = computeHmac("sha256", secret, body);
      const options = {
        header: "x-signature",
        algorithm: "sha256" as const,
        encoding: "hex" as const,
        prefix: "",
      };
      const headers = new Headers({
        "x-signature": expected.toString("hex"),
      });
      const alteredBody = new Uint8Array(body);
      alteredBody[0] = (alteredBody[0]! + 1) % 256;
      const result = SIGNATURE_VERIFIERS.hmac({
        secret,
        headers,
        body: alteredBody,
        now: 0,
        options,
      });
      expect(result).toBe(false);
    });

    test("wrong secret", () => {
      const secret = "correct-secret";
      const expected = computeHmac("sha256", secret, body);
      const options = {
        header: "x-signature",
        algorithm: "sha256" as const,
        encoding: "hex" as const,
        prefix: "",
      };
      const headers = new Headers({
        "x-signature": expected.toString("hex"),
      });
      const result = SIGNATURE_VERIFIERS.hmac({
        secret: "wrong-secret",
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(false);
    });

    test("missing header", () => {
      const secret = "test-secret";
      const options = {
        header: "x-signature",
        algorithm: "sha256" as const,
        encoding: "hex" as const,
        prefix: "",
      };
      const headers = new Headers({});
      const result = SIGNATURE_VERIFIERS.hmac({
        secret,
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(false);
    });

    test("missing prefix", () => {
      const secret = "test-secret";
      const expected = computeHmac("sha256", secret, body);
      const options = {
        header: "x-signature",
        algorithm: "sha256" as const,
        encoding: "hex" as const,
        prefix: "sha256=",
      };
      const headers = new Headers({
        "x-signature": expected.toString("hex"),
      });
      const result = SIGNATURE_VERIFIERS.hmac({
        secret,
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(false);
    });

    test("malformed encoding (hex when base64 expected)", () => {
      const secret = "test-secret";
      const expected = computeHmac("sha256", secret, body);
      const options = {
        header: "x-signature",
        algorithm: "sha256" as const,
        encoding: "base64" as const,
        prefix: "",
      };
      const headers = new Headers({
        "x-signature": expected.toString("hex"),
      });
      const result = SIGNATURE_VERIFIERS.hmac({
        secret,
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(false);
    });

    test("malformed base64", () => {
      const options = {
        header: "x-signature",
        algorithm: "sha256" as const,
        encoding: "base64" as const,
        prefix: "",
      };
      const headers = new Headers({
        "x-signature": "not-valid-base64-!!!",
      });
      const result = SIGNATURE_VERIFIERS.hmac({
        secret: "test-secret",
        headers,
        body,
        now: 0,
        options,
      });
      expect(result).toBe(false);
    });
  });
});

import { afterAll, expect, test } from "bun:test";

import type { RelayPackage } from "@pockrew/pwr-shared/schemas";

import { forwardRelayPackage } from "./forwarder";

const seen: string[] = [];
const target = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (request) => {
    seen.push(new URL(request.url).search);
    return new Response("ok");
  },
});
afterAll(() => target.stop(true));

const packet = (rawQuery: string | null): RelayPackage => ({
  id: "delivery",
  eventId: "event",
  endpointId: "endpoint",
  tunnelId: "tunnel",
  trigger: "live",
  replayOfDeliveryId: null,
  relayStatus: null,
  method: "POST",
  contentType: "application/json",
  payloadBase64: Buffer.from("{}").toString("base64"),
  headers: "{}",
  queryParams: "{}",
  rawQuery,
  eventReceivedAt: new Date().toISOString(),
});

test("the target's own query survives, followed by the provider's raw query", async () => {
  const base = `http://127.0.0.1:${target.port}/hook`;
  seen.length = 0;
  await forwardRelayPackage(packet(""), `${base}?token=abc`, "default");
  await forwardRelayPackage(packet("b=2&a=%201"), `${base}?token=abc`, "default");
  await forwardRelayPackage(packet("b=2&a=%201"), base, "default");
  await forwardRelayPackage(packet(null), `${base}?token=abc`, "default");
  expect(seen).toEqual(["?token=abc", "?token=abc&b=2&a=%201", "?b=2&a=%201", "?token=abc"]);
});

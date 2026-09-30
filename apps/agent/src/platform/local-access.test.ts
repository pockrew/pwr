import { resolve } from "node:path";
import { tunnelManager } from "@agent/modules/relays/service";
import { describe, expect, it } from "bun:test";

import { app } from "~/app";

describe("Local agent boundary", () => {
  it("allows the existing Studio origin and local CLI requests", async () => {
    for (const origin of [
      "http://localhost:15174",
      "http://127.0.0.1:15174",
      "http://127.0.0.1:18788",
      "http://[::1]:18788",
    ]) {
      const response = await app.request("/health", {
        headers: { origin, host: "localhost:15174" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
    expect((await app.request("/health")).status).toBe(200);
    const preflight = await app.request("/tunnels/connect", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:15174",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:15174");
  });

  it("rejects untrusted origins, rebinding hosts and browser mutations before handlers", async () => {
    for (const origin of [
      "https://untrusted.example",
      "null",
      "http://localhost:9999",
      "http://localhost:15174.untrusted.example",
    ]) {
      for (const method of ["GET", "POST", "OPTIONS"]) {
        const response = await app.request(method === "GET" ? "/tunnels" : "/proxy", {
          method,
          headers: { origin, "content-type": "application/json" },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        expect(response.status).toBe(403);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }
    }
    expect((await app.request("http://rebind.example/tunnels")).status).toBe(403);
    expect((await app.request("/health", { headers: { host: "rebind.example" } })).status).toBe(
      403,
    );
    expect(
      (await app.request("/health", { headers: { "sec-fetch-site": "cross-site" } })).status,
    ).toBe(403);
  });

  it("does not expose session API keys through the public tunnel response", async () => {
    const tunnelId = `secret-${crypto.randomUUID()}`;
    const apiKey = `private-${crypto.randomUUID()}`;
    // Port 1 has no test server; disconnect immediately to cancel reconnection.
    tunnelManager.connect({
      tunnelId,
      serverWsUrl: "ws://127.0.0.1:1",
      apiKey,
    });
    try {
      const response = await app.request("/tunnels");
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(text).toContain(tunnelId);
      expect(text).not.toContain(apiKey);
      expect(text).not.toContain('"apiKey"');
      expect(tunnelManager.getTunnel(tunnelId)).not.toHaveProperty("apiKey");
    } finally {
      tunnelManager.disconnect(tunnelId);
    }
  });

  it("refuses a public bind before starting the daemon", () => {
    const child = Bun.spawnSync([process.execPath, "src/platform/local-access.ts"], {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...process.env, PWR_AGENT_HOST: "0.0.0.0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).not.toBe(0);
    expect(child.stderr.toString()).toContain("PWR_AGENT_HOST");
  });
});

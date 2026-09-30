import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { AgentProxyUpdateSchema, AgentRelayConnectSchema } from "@pockrew/pwr-shared/schemas";

import {
  agentCleanRetention,
  agentConnectTunnel,
  agentDisconnectTunnel,
  agentGetProxy,
  agentGetRequest,
  agentListRequestDeliveries,
  agentListRequests,
  agentReplayRequest,
  agentSetProxy,
  checkAgentHealth,
  fetchAgentTunnels,
  getAgentTunnel,
  resolveAgentCommand,
  streamAgentEvents,
  type AgentRpcClient,
} from "./daemon.client";

describe("Agent Daemon RPC Client", () => {
  const envelope = <T>(data: T) => ({ data, requestId: "test-request" });
  let lastConnectPayload: unknown;
  let healthStatus: "ok" | "storage_blocked" = "ok";
  let lastRequestScope: Record<string, string> = {};
  let lastReplayScope: Record<string, string> = {};
  let proxyConfig = {
    mode: "manual" as "auto" | "manual" | "disabled",
    httpProxy: "http://127.0.0.1:8888",
    httpsProxy: "http://127.0.0.1:9999",
    noProxy: "localhost",
    caCertPath: "/tmp/agent-ca.pem",
  };
  // 1. Create mock agent server for testing RPC endpoints
  const mockApp = new Hono()
    .get("/health", (c) => {
      return c.json(
        envelope({
          status: healthStatus,
          ...(healthStatus === "storage_blocked" ? { storage: { reason: "capacity" } } : {}),
          uptimeSeconds: 120,
          activeTunnelsCount: 2,
          totalTunnelsCount: 3,
        }),
      );
    })
    .get("/tunnels", (c) => {
      return c.json(
        envelope({
          tunnels: [
            {
              tunnelId: "tun-1",
              slug: "server-slug",
              serverWsUrl: "ws://localhost:3000",
              projectId: "default",
              status: "connected",
              connectedAt: Date.now(),
            },
          ],
        }),
      );
    })
    .get("/tunnels/:tunnelId", (c) => {
      return c.json(
        envelope({
          tunnel: {
            tunnelId: c.req.param("tunnelId"),
            slug: "server-slug",
            serverWsUrl: "http://localhost:3000",
            projectId: "default",
            status: "connected",
          },
        }),
      );
    })
    .post("/tunnels/connect", async (c) => {
      const parsed = AgentRelayConnectSchema.safeParse(await c.req.json());
      if (!parsed.success)
        return c.json({ code: "VALIDATION_ERROR", requestId: "test-request" }, 400);
      lastConnectPayload = parsed.data;
      return c.json(envelope({ tunnelId: "tun-1", status: "connecting" }));
    })
    .post("/tunnels/disconnect", (c) => {
      return c.json(envelope({ tunnelId: "tun-1", status: "disconnected" }));
    })
    .get("/requests", (c) => {
      if (c.req.query("limit") === "999") {
        return c.json({ code: "VALIDATION_ERROR", requestId: "test-request" }, 400);
      }
      return c.json(
        envelope({
          count: 1,
          nextCursor: c.req.query("cursor") ? null : "next-request",
          items: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              tunnelId: "tun-1",
              orgId: "default",
              projectId: "default",
              method: "POST",
              url: "/webhook",
              headers: { "content-type": "application/json" },
              status: 200,
              executionTimeMs: 12,
              createdAt: 1700000000000,
            },
          ],
        }),
      );
    })
    .get("/requests/:id", (c) => {
      lastRequestScope = Object.fromEntries(new URL(c.req.url).searchParams);
      const id = c.req.param("id");
      if (id === "missing") return c.json({ code: "NOT_FOUND", requestId: "test-request" }, 404);
      return c.json(
        envelope({
          id,
          tunnelId: "tun-1",
          orgId: "default",
          projectId: "default",
          method: "POST",
          url: "/webhook",
          headers: { "content-type": "application/json" },
          status: 200,
          executionTimeMs: 12,
          createdAt: 1700000000000,
        }),
      );
    })
    .get("/requests/:id/deliveries", (c) => {
      lastRequestScope = Object.fromEntries(new URL(c.req.url).searchParams);
      return c.json(
        envelope({
          count: 1,
          nextCursor: c.req.query("cursor") ? null : "next-delivery",
          items: [
            {
              id: c.req.query("cursor") ? "delivery-2" : "delivery-1",
              endpointId: "endpoint-1",
              completed: true,
              eventId: c.req.param("id"),
            },
          ],
        }),
      );
    })
    .post("/replay/:id", (c) => {
      lastReplayScope = Object.fromEntries(new URL(c.req.url).searchParams);
      const id = c.req.param("id");
      if (id === "ambiguous") return c.json({ code: "CONFLICT", requestId: "test-request" }, 409);
      return c.json(
        envelope({
          delivery: {
            webhookId: id,
            tunnelId: "tun-1",
            orgId: "default",
            projectId: "default",
            targetUrl: "http://localhost:8080/webhook",
            statusCode: 200,
            latencyMs: 15,
            deliveredAt: 1700000000000,
          },
        }),
      );
    })
    .get("/proxy", (c) => {
      return c.json(
        envelope({
          config: proxyConfig,
          detected: { httpProxy: "http://127.0.0.1:8888" },
        }),
      );
    })
    .post("/proxy", async (c) => {
      const body = await c.req.json();
      const parsed = AgentProxyUpdateSchema.safeParse(body);
      if (!parsed.success)
        return c.json({ code: "VALIDATION_ERROR", requestId: "test-request" }, 400);
      proxyConfig = parsed.data as typeof proxyConfig;
      return c.json(envelope({ proxy: body }));
    })
    .post("/maintenance/clean", (c) => {
      return c.json(
        envelope({
          action: "clean",
          affectedProjects: ["default"],
          processedCount: 5,
          deletedCount: 5,
          durationMs: 4,
        }),
      );
    })
    .get("/events/stream/:tunnelId", (c) => {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: "webhook",
          data: JSON.stringify({
            id: "11111111-1111-4111-8111-111111111111",
            tunnelId: c.req.param("tunnelId"),
            orgId: "default",
            projectId: "default",
            method: "POST",
            headers: {},
            status: 200,
            executionTimeMs: 1,
            createdAt: Date.now(),
          }),
        });
        await stream.writeSSE({
          event: "delivery",
          data: JSON.stringify({
            type: "delivery_result",
            eventId: "11111111-1111-4111-8111-111111111111",
            deliveryId: "delivery-1",
            trigger: "live",
            statusCode: 202,
            latencyMs: 12,
          }),
        });
      });
    });

  const testServer = Bun.serve({
    port: 0,
    fetch: mockApp.fetch,
  });
  const baseUrl = `http://127.0.0.1:${testServer.port}`;

  const mockClient = {
    health: {
      $get: async () => testServer.fetch(new Request(`${baseUrl}/health`)),
    },
    tunnels: {
      $get: async () => testServer.fetch(new Request(`${baseUrl}/tunnels`)),
      ":tunnelId": {
        $get: async (args: { param: { tunnelId: string } }) =>
          testServer.fetch(new Request(`${baseUrl}/tunnels/${args.param.tunnelId}`)),
      },
      connect: {
        $post: async (args: { json: unknown }) =>
          testServer.fetch(
            new Request(`${baseUrl}/tunnels/connect`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(args.json),
            }),
          ),
      },
      disconnect: {
        $post: async (args: { json: unknown }) =>
          testServer.fetch(
            new Request(`${baseUrl}/tunnels/disconnect`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(args.json),
            }),
          ),
      },
    },
    requests: Object.assign(async () => testServer.fetch(new Request(`${baseUrl}/requests`)), {
      $get: async (args?: { query?: Record<string, string> }) => {
        const url = new URL(`${baseUrl}/requests`);
        for (const [key, value] of Object.entries(args?.query ?? {}))
          url.searchParams.set(key, value);
        return testServer.fetch(new Request(url.toString()));
      },
      ":id": {
        $get: async (args: { param: { id: string }; query?: Record<string, string> }) => {
          const url = new URL(`${baseUrl}/requests/${args.param.id}`);
          for (const [key, value] of Object.entries(args.query ?? {}))
            if (value !== undefined) url.searchParams.set(key, value);
          return testServer.fetch(new Request(url.toString()));
        },
        deliveries: {
          $get: async (args: { param: { id: string }; query?: Record<string, string> }) => {
            const url = new URL(`${baseUrl}/requests/${args.param.id}/deliveries`);
            for (const [key, value] of Object.entries(args.query ?? {}))
              if (value !== undefined) url.searchParams.set(key, value);
            return testServer.fetch(new Request(url.toString()));
          },
        },
      },
    }),
    replay: {
      ":id": {
        $post: async (args: {
          param: { id: string };
          json: unknown;
          query?: Record<string, string>;
        }) => {
          const url = new URL(`${baseUrl}/replay/${args.param.id}`);
          for (const [key, value] of Object.entries(args.query ?? {}))
            if (value !== undefined) url.searchParams.set(key, value);
          return testServer.fetch(
            new Request(url.toString(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(args.json),
            }),
          );
        },
      },
    },
    proxy: {
      $get: async () => testServer.fetch(new Request(`${baseUrl}/proxy`)),
      $post: async (args: { json: unknown }) =>
        testServer.fetch(
          new Request(`${baseUrl}/proxy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args.json),
          }),
        ),
    },
    maintenance: {
      clean: {
        $post: async (args: { json: unknown }) =>
          testServer.fetch(
            new Request(`${baseUrl}/maintenance/clean`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(args.json),
            }),
          ),
      },
    },
  } as unknown as AgentRpcClient;

  test("probes agent health accurately", async () => {
    // 1. Probe health on test server port
    const health = await checkAgentHealth(testServer.port);
    expect(health.online).toBe(true);
    expect(health.uptimeSeconds).toBe(120);
    expect(health.activeTunnelsCount).toBe(2);
    healthStatus = "storage_blocked";
    try {
      const blocked = await checkAgentHealth(testServer.port);
      expect(blocked.online).toBe(true);
      expect(blocked.status).toBe("storage_blocked");
      expect(blocked.storage?.reason).toBe("capacity");
    } finally {
      healthStatus = "ok";
    }
  });

  test("locates the Agent independently of the caller's working directory", () => {
    expect(resolveAgentCommand().join(" ")).toContain("agent/src/index.ts");
  });

  test("rejects malformed and unknown CLI flags instead of silently running", () => {
    for (const args of [
      ["inspect", "--limit", "10junk"],
      ["inspect", "--unknown"],
      ["clean", "--days", "7later"],
    ]) {
      const child = Bun.spawnSync(
        [process.execPath, resolve(import.meta.dir, "../index.ts"), ...args],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(child.exitCode).toBe(1);
      expect(new TextDecoder().decode(child.stderr)).toContain("Error:");
    }
  });

  test("connects and disconnects tunnels via RPC", async () => {
    // 1. Connect tunnel
    const connectRes = await agentConnectTunnel(mockClient, {
      tunnelId: "tun-1",
      slug: "server-slug",
      serverWsUrl: "ws://localhost:3000",
      apiKey: "relay-test-key",
      projectId: "default",
    });
    expect(connectRes.success).toBe(true);
    expect(lastConnectPayload).toEqual({
      tunnelId: "tun-1",
      slug: "server-slug",
      serverWsUrl: "ws://localhost:3000",
      apiKey: "relay-test-key",
      projectId: "default",
    });
    expect((await fetchAgentTunnels(mockClient))[0]?.slug).toBe("server-slug");
    expect((await getAgentTunnel(mockClient, "tun-1"))?.status).toBe("connected");

    // 2. The Agent contract rejects the retired tunnel-wide target field.
    const legacy = await agentConnectTunnel(mockClient, {
      tunnelId: "tun-1",
      serverWsUrl: "ws://localhost:3000",
      targetUrl: "http://localhost:8080",
    } as Parameters<typeof agentConnectTunnel>[1]);
    expect(legacy.success).toBe(false);
    expect(legacy.message).toContain("VALIDATION_ERROR");

    // 3. Disconnect tunnel
    const disconnRes = await agentDisconnectTunnel(mockClient, "tun-1");
    expect(disconnRes).toBe(true);
  });

  test("CLI refuses a relay key passed on the command line", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../index.ts"),
        "connect",
        "slug",
        "--api-key",
        "leaked",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("stdin");
  });

  test("CLI maps server slug and local alias into the Agent connect contract", async () => {
    lastConnectPayload = undefined;
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../index.ts"),
        "connect",
        "server-slug",
        "--alias",
        "tun-1",
        "--server",
        "ws://localhost:3000",
        "--api-key",
        "-",
        "--port",
        String(testServer.port),
      ],
      // Secrets come from stdin, never argv (shell history, `ps`).
      { stdin: new Blob(["relay-test-key\n"]), stdout: "pipe", stderr: "pipe" },
    );
    try {
      for (let i = 0; i < 60 && lastConnectPayload === undefined; i += 1) await Bun.sleep(50);
      expect(lastConnectPayload).toEqual({
        tunnelId: "tun-1",
        slug: "server-slug",
        serverWsUrl: "ws://localhost:3000",
        apiKey: "relay-test-key",
        projectId: "default",
      });
    } finally {
      child.kill();
      await child.exited;
    }
  });

  test("CLI reads a bootstrap relay key from stdin without putting it in argv", async () => {
    lastConnectPayload = undefined;
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../index.ts"),
        "connect",
        "server-slug",
        "--alias",
        "tun-1",
        "--server",
        "ws://localhost:3000",
        "--api-key",
        "-",
        "--port",
        String(testServer.port),
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    child.stdin!.write("relay-piped-key\n");
    child.stdin!.end();
    try {
      for (let i = 0; i < 60 && lastConnectPayload === undefined; i += 1) await Bun.sleep(50);
      expect(lastConnectPayload).toMatchObject({ apiKey: "relay-piped-key" });
    } finally {
      child.kill();
      await child.exited;
    }
  });

  test("lists and inspects webhook requests via RPC", async () => {
    // 1. List requests
    const res = await agentListRequests(mockClient, { limit: 10 });
    expect(res.items.length).toBe(1);
    expect(res.items[0]?.method).toBe("POST");
    expect(res.nextCursor).toBe("next-request");
    expect(
      (await agentListRequests(mockClient, { cursor: res.nextCursor ?? undefined })).nextCursor,
    ).toBeNull();

    // 2. Get single request detail
    const scope = { tunnelId: "tun-1", projectId: "default" };
    const event = await agentGetRequest(mockClient, "11111111-1111-4111-8111-111111111111", scope);
    expect(event).not.toBeNull();
    expect(event?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(lastRequestScope).toEqual(scope);
    const deliveries = await agentListRequestDeliveries(mockClient, event!.id, scope);
    expect(deliveries[0]?.id).toBe("delivery-1");
    expect(deliveries[1]?.id).toBe("delivery-2");
    expect(lastRequestScope).toEqual({ ...scope, limit: "100", cursor: "next-delivery" });
    expect(await agentGetRequest(mockClient, "missing")).toBeNull();
    await expect(agentListRequests(mockClient, { limit: 999 })).rejects.toThrow("HTTP 400");
  });

  test("replays webhook request via RPC", async () => {
    // 1. Dispatch replay
    const scope = { tunnelId: "tun-1", projectId: "default" };
    const res = await agentReplayRequest(mockClient, "11111111-1111-4111-8111-111111111111", scope);
    expect(res.success).toBe(true);
    expect(res.delivery?.statusCode).toBe(200);
    expect(lastReplayScope).toEqual(scope);
    const ambiguous = await agentReplayRequest(mockClient, "ambiguous");
    expect(ambiguous.error).toContain("delivery ID");
  });

  test("manages proxy and retention maintenance via RPC", async () => {
    // 1. Get and set proxy
    const proxy = await agentGetProxy(mockClient);
    expect(proxy?.config?.mode).toBe("manual");

    const updatedProxy = await agentSetProxy(mockClient, { noProxy: "localhost,.internal" });
    expect(updatedProxy?.success).toBe(true);
    expect(proxyConfig).toMatchObject({
      mode: "manual",
      httpProxy: "http://127.0.0.1:8888",
      httpsProxy: "http://127.0.0.1:9999",
      noProxy: "localhost,.internal",
      caCertPath: "/tmp/agent-ca.pem",
    });

    // 2. Retention maintenance clean
    const cleanRes = await agentCleanRetention(mockClient, {
      action: "clean",
      days: 7,
      all: true,
      confirmToken: "CONFIRM_ALL",
    });
    expect(cleanRes?.deletedCount).toBe(5);
  });

  test("proxy CLI keeps existing manual URLs when updating only no-proxy", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../index.ts"),
        "proxy",
        "set",
        "--no-proxy",
        "localhost,.company",
        "--port",
        String(testServer.port),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
    expect(proxyConfig).toMatchObject({
      mode: "manual",
      httpProxy: "http://127.0.0.1:8888",
      httpsProxy: "http://127.0.0.1:9999",
      noProxy: "localhost,.company",
      caCertPath: "/tmp/agent-ca.pem",
    });
  });

  test("separates received webhook and committed target result in the live stream", async () => {
    const received: string[] = [];
    const result: string[] = [];
    const controller = streamAgentEvents(
      testServer.port!,
      "tun-1",
      (event) => received.push(event.id),
      undefined,
      (delivery) => result.push(delivery.deliveryId),
    );
    try {
      for (let i = 0; i < 30 && result.length === 0; i += 1) await Bun.sleep(20);
      expect(received).toEqual(["11111111-1111-4111-8111-111111111111"]);
      expect(result).toEqual(["delivery-1"]);
    } finally {
      controller.abort();
    }
  });
});

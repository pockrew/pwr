import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { app } from "~/app";

import { agentFiles } from "./data-dir";
import { listenLocalApi } from "./listen";

const servers: { stop: (force?: boolean) => unknown }[] = [];
const occupy = () => {
  const busy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy") });
  servers.push(busy);
  return busy.port ?? 0;
};
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

test("a busy default port falls back to a free one, recorded for the CLI and trusted for Studio", async () => {
  const busy = occupy();
  const server = listenLocalApi(app.fetch, busy, true);
  servers.push(server);
  expect(server.port).not.toBe(busy);
  expect(readFileSync(agentFiles.port, "utf8").trim()).toBe(String(server.port));
  const origin = `http://127.0.0.1:${server.port}`;
  const response = await fetch(`${origin}/health`, { headers: { origin } });
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
});

test("a pinned port that is busy fails instead of moving", () => {
  const busy = occupy();
  expect(() => listenLocalApi(app.fetch, busy, false)).toThrow();
});

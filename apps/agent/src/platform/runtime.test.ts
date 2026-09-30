import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Hono } from "hono";

import { mountFrontend, resolveStudioDist } from "./runtime";

const root = mkdtempSync(join(tmpdir(), "agent-studio-runtime-"));
mkdirSync(join(root, "assets"));
writeFileSync(join(root, "index.html"), "<!doctype html><title>Studio fixture</title>");
writeFileSync(join(root, "assets", "app-a1b2.js"), "console.log('fixture');");
writeFileSync(join(root, "favicon.svg"), "<svg></svg>");
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("production serves Studio files and navigation without swallowing missing API/assets", async () => {
  const app = new Hono()
    .get("/health", (c) => c.json({ status: "ok" }))
    .route("/", mountFrontend("production", root));
  for (const path of ["/", "/settings", "/endpoints", "/compare"]) {
    const response = await app.request(path, { headers: { accept: "text/html" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Studio fixture");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  }
  const asset = await app.request("/assets/app-a1b2.js");
  expect(asset.status).toBe(200);
  expect(asset.headers.get("cache-control")).toContain("immutable");
  expect(await asset.text()).toContain("fixture");
  expect((await app.request("/favicon.svg")).status).toBe(200);
  for (const path of [
    "/assets/missing.js",
    "/assets/missing",
    "/missing.js",
    "/api/missing",
    "/tunnels/missing/operation",
    "/mcp",
    "/requests/missing",
    "/proxy/missing",
  ]) {
    const response = await app.request(path, { headers: { accept: "text/html" } });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Studio fixture");
  }
  expect((await app.request("/settings", { method: "POST" })).status).toBe(404);
  expect((await app.request("/unknown", { headers: { accept: "application/json" } })).status).toBe(
    404,
  );
  expect(await (await app.request("/health")).json()).toEqual({ status: "ok" });
});

test("development and test leave HTML/HMR to Vite even when a build exists", async () => {
  for (const mode of ["development", "test"]) {
    const app = mountFrontend(mode, root);
    for (const path of ["/", "/settings", "/assets/app-a1b2.js"]) {
      expect((await app.request(path, { headers: { accept: "text/html" } })).status).toBe(404);
    }
  }
});

test("an explicit Studio path is validated and never silently falls back", () => {
  const previous = process.env["STUDIO_DIST_DIR"];
  try {
    process.env["STUDIO_DIST_DIR"] = root;
    expect(resolveStudioDist()).toBe(root);
    process.env["STUDIO_DIST_DIR"] = join(root, "absent");
    expect(() => resolveStudioDist()).toThrow("index.html");
    expect(() => mountFrontend("development")).not.toThrow();
  } finally {
    if (previous === undefined) delete process.env["STUDIO_DIST_DIR"];
    else process.env["STUDIO_DIST_DIR"] = previous;
  }
});

test("compiled runtime reads NODE_ENV at launch instead of freezing the build-time mode", () => {
  const entry = join(root, "runtime-probe.ts");
  const binary = join(root, "runtime-probe");
  writeFileSync(
    entry,
    `import { mountFrontend } from ${JSON.stringify(resolve(import.meta.dir, "runtime.ts"))};\nconst response = await mountFrontend().request("/", { headers: { accept: "text/html" } });\nconsole.log(response.status);`,
  );
  // Compile under the test mode; installed binaries must still switch both ways at launch.
  const build = Bun.spawnSync(
    [process.execPath, "build", "--compile", "--minify", entry, "--outfile", binary],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(build.exitCode).toBe(0);
  for (const { mode, expected } of [
    { mode: "production", expected: "200" },
    { mode: "development", expected: "404" },
  ]) {
    const run = Bun.spawnSync([binary], {
      cwd: root,
      env: { ...process.env, NODE_ENV: mode, STUDIO_DIST_DIR: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe(expected);
  }
});

import { describe, expect, test } from "bun:test";

process.env["BETTER_AUTH_SECRET"] = "runtime-test-secret-at-least-32-characters-long";
process.env["ADMIN_EMAIL"] = "runtime-test@example.com";
process.env["ADMIN_PASSWORD"] = "runtime-test-password";

const { app } = await import("@server/app");

describe("Server Routing & Frontend SPA Mounting", () => {
  test("relay route is not blocked by SPA and executes relay handler", async () => {
    const res = await app.request("/relay/test-tunnel");
    // Non-existent tunnel returns 404 from ingress/relay service, NOT from SPA HTML fallback
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("code", "NOT_FOUND");
    expect(body).toHaveProperty("requestId");
  });

  test("GET ingress route is not blocked by SPA and executes ingress handler", async () => {
    const res = await app.request("/ingress/test-tunnel/stripe");
    // Handled by ingress service (returns JSON 404 for unknown tunnel, never HTML)
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("code", "NOT_FOUND");
    expect(body).toHaveProperty("requestId");
  });

  test("POST ingress route is not blocked by SPA and executes ingress handler", async () => {
    const res = await app.request("/ingress/test-tunnel/stripe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("code", "NOT_FOUND");
  });

  test("API routes return JSON and are never masked by SPA fallback", async () => {
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    const healthData = await health.json();
    expect(healthData).toHaveProperty("data");

    const unknownApi = await app.request("/api/unknown-endpoint");
    expect(unknownApi.status).toBe(404);
    const unknownData = await unknownApi.json();
    expect(unknownData).toHaveProperty("code", "API_NOT_FOUND");
  });

  test("Admin SPA is served on /admin/ and / redirects to /admin/", async () => {
    const root = await app.request("/");
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/admin/");

    const admin = await app.request("/admin/");
    expect(admin.status).toBe(200);
    const html = await admin.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("PWR Admin");
  });

  test("Favicons and assets are served with appropriate caching headers", async () => {
    const rootFavicon = await app.request("/favicon.ico");
    expect(rootFavicon.status).toBe(200);

    const adminFavicon = await app.request("/admin/favicon.ico");
    expect(adminFavicon.status).toBe(200);

    const asset = await app.request("/admin/assets/logo-icon.png");
    // If the file exists, it should be 200 with immutable header
    if (asset.status === 200) {
      expect(asset.headers.get("cache-control")).toContain("immutable");
    }
  });
});

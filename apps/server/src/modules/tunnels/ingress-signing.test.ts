import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

process.env["BETTER_AUTH_SECRET"] = "signing-management-test-secret-long-enough";
process.env["ADMIN_EMAIL"] = "signing-management@example.com";
process.env["ADMIN_PASSWORD"] = "signing-management-password";
const { app } = await import("@server/app");
const { db } = await import("@server/db/client");
const { ingressSigning, tunnels } = await import("@server/db/schemas");
const { user } = await import("@server/db/schemas/auth");
const { auth } = await import("@server/modules/auth/configs");
const { env } = await import("@server/platform/env");
const signing = await import("@server/modules/ingress/signing");

test("only the account controls signed ingress; reads and storage never reveal the secret", async () => {
  const tunnelId = "signing-management-tunnel";
  const path = `/api/tunnels/${tunnelId}/ingress-signing`;
  const secret = "github-management-test-secret";
  db.insert(tunnels).values({ id: tunnelId, slug: "signing-management", name: "Signing" }).run();
  try {
    expect(
      (
        await app.request(path, {
          method: "PUT",
          headers: { "x-api-key": "unprivileged", "content-type": "application/json" },
          body: JSON.stringify({ provider: "github", secret }),
        })
      ).status,
    ).toBe(403);
    await auth.api.signUpEmail({
      body: { name: "Admin", email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD ?? "" },
    });
    const login = await auth.api.signInEmail({
      body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD ?? "" },
      asResponse: true,
    });
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const result = await app.request(path, {
      method: "PUT",
      headers: {
        cookie,
        origin: new URL(env.PUBLIC_URL).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ provider: "github", secret }),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      data: { provider: "github", configured: true, options: null, available: true },
      requestId: expect.any(String),
    });
    const status = await app.request(path, { headers: { cookie } });
    expect(await status.json()).toEqual({
      data: { provider: "github", configured: true, options: null, available: true },
      requestId: expect.any(String),
    });
    expect(
      db.select().from(ingressSigning).where(eq(ingressSigning.tunnelId, tunnelId)).get()
        ?.encryptedSecret,
    ).not.toContain(secret);
    const removed = await app.request(path, {
      method: "DELETE",
      headers: { cookie, origin: new URL(env.PUBLIC_URL).origin },
    });
    expect(removed.status).toBe(200);
    expect(
      db.select().from(ingressSigning).where(eq(ingressSigning.tunnelId, tunnelId)).all(),
    ).toHaveLength(0);
  } finally {
    db.delete(user).where(eq(user.email, env.ADMIN_EMAIL)).run();
    db.delete(tunnels).where(eq(tunnels.id, tunnelId)).run();
  }
});

test("custom HMAC options change without resending the secret; no key means no signed mode", () => {
  const { setSigningConfig, signingConfig, signingStatus } = signing;
  const tunnelId = "signing-options-tunnel";
  db.insert(tunnels).values({ id: tunnelId, slug: "signing-options", name: "Options" }).run();
  const options = { header: "x-sig", algorithm: "sha256", encoding: "hex", prefix: "" } as const;
  try {
    // 1. A secret is required unless a custom HMAC secret is already saved.
    expect(() => setSigningConfig(tunnelId, { provider: "hmac", options })).toThrow();
    setSigningConfig(tunnelId, { provider: "hmac", secret: "first-secret", options });
    const saved = signingConfig(tunnelId)?.encryptedSecret;
    const changed = { ...options, header: "x-other", encoding: "base64" } as const;
    expect(setSigningConfig(tunnelId, { provider: "hmac", options: changed })).toMatchObject({
      options: changed,
    });
    expect(signingConfig(tunnelId)?.encryptedSecret).toBe(saved);
    // 2. Without the encryption key the status says so and saving fails with a clear code.
    const key = env.WEBHOOK_SIGNING_ENCRYPTION_KEY;
    env.WEBHOOK_SIGNING_ENCRYPTION_KEY = undefined;
    try {
      expect(signingStatus(tunnelId).available).toBe(false);
      expect(() => setSigningConfig(tunnelId, { provider: "github", secret: "s" })).toThrow(
        expect.objectContaining({ status: 409, code: "SIGNING_UNAVAILABLE" }),
      );
    } finally {
      env.WEBHOOK_SIGNING_ENCRYPTION_KEY = key;
    }
  } finally {
    db.delete(ingressSigning).where(eq(ingressSigning.tunnelId, tunnelId)).run();
    db.delete(tunnels).where(eq(tunnels.id, tunnelId)).run();
  }
});

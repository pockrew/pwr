import { beforeEach, expect, test } from "bun:test";

process.env["BETTER_AUTH_SECRET"] = "admin-bootstrap-test-secret-at-least-32-characters";
process.env["ADMIN_EMAIL"] = "bootstrap@example.com";
process.env["ADMIN_PASSWORD"] = "bootstrap-test-password";

const { db } = await import("@server/db/client");
const { account, user } = await import("@server/db/schemas/auth");
const { env } = await import("@server/platform/env");
const { ensureAdminAccount } = await import("./bootstrap");
const { auth } = await import("./configs");

beforeEach(() => db.delete(user).run());

test("fresh startup creates one usable admin and restart preserves its credentials", async () => {
  await ensureAdminAccount();
  const first = db.select().from(user).get();
  expect(first?.email).toBe(env.ADMIN_EMAIL);
  expect(db.select().from(account).all()).toHaveLength(1);
  await ensureAdminAccount();
  expect(db.select().from(user).all()).toHaveLength(1);
  expect(db.select().from(user).get()?.id).toBe(first?.id);
  const login = await auth.api.signInEmail({
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD ?? "" },
    asResponse: true,
  });
  expect(login.status).toBe(200);
});

test("a different existing account fails startup without creating another one", async () => {
  await ensureAdminAccount();
  db.update(user).set({ email: "other@example.com" }).run();
  await expect(ensureAdminAccount()).rejects.toThrow("Configured admin account");
  expect(db.select().from(user).all()).toHaveLength(1);
});

test("initial password is required only while the auth database is empty", async () => {
  const password = env.ADMIN_PASSWORD;
  env.ADMIN_PASSWORD = undefined;
  try {
    await expect(ensureAdminAccount()).rejects.toThrow("ADMIN_PASSWORD is required");
    expect(db.select().from(user).all()).toHaveLength(0);
  } finally {
    env.ADMIN_PASSWORD = password;
  }
  await ensureAdminAccount();
  env.ADMIN_PASSWORD = undefined;
  try {
    await ensureAdminAccount();
  } finally {
    env.ADMIN_PASSWORD = password;
  }
});

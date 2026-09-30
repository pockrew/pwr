import { describe, expect, it } from "bun:test";

process.env["BETTER_AUTH_SECRET"] = "test-secret-at-least-32-characters-long";
process.env["ADMIN_EMAIL"] = "test-admin@example.com";
process.env["ADMIN_PASSWORD"] = "test-admin-password";

const { parseEnv } = await import("./env");

describe("Server Environment Configuration", () => {
  const validBaseEnv = {
    PUBLIC_URL: "http://localhost:18787",
    BETTER_AUTH_SECRET: "a-very-long-secret-key-that-is-at-least-32-chars",
    ADMIN_EMAIL: "admin@mycorp.internal",
  };

  it("successfully parses valid environment with defaults", () => {
    const parsed = parseEnv(validBaseEnv);
    expect(parsed.PORT).toBe(18787);
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.ADMIN_EMAIL).toBe("admin@mycorp.internal");
    expect(parsed.ADMIN_NAME).toBe("Admin");
    expect(parsed.ADMIN_PASSWORD).toBeUndefined();
    expect(parsed.WEBHOOK_SIGNING_ENCRYPTION_KEY).toBeUndefined();
  });

  it("throws descriptive error when required BETTER_AUTH_SECRET is missing or too short", () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv,
        BETTER_AUTH_SECRET: "short-secret",
      }),
    ).toThrow("Invalid server environment configuration: BETTER_AUTH_SECRET");
  });

  it("throws descriptive error when ADMIN_EMAIL is missing or invalid", () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv,
        ADMIN_EMAIL: "not-an-email",
      }),
    ).toThrow("Invalid server environment configuration: ADMIN_EMAIL");
  });

  it("coerces empty string optional fields to undefined without throwing", () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      ADMIN_PASSWORD: "",
      WEBHOOK_SIGNING_ENCRYPTION_KEY: "   ",
      TRUSTED_PROXIES: "",
      ADMIN_NAME: "",
    });

    expect(parsed.ADMIN_PASSWORD).toBeUndefined();
    expect(parsed.WEBHOOK_SIGNING_ENCRYPTION_KEY).toBeUndefined();
    expect(parsed.TRUSTED_PROXIES).toBeUndefined();
    expect(parsed.ADMIN_NAME).toBe("Admin");
  });

  it("validates ADMIN_PASSWORD when explicitly provided", () => {
    const parsed = parseEnv({
      ...validBaseEnv,
      ADMIN_PASSWORD: "SuperSecretPassword123!",
    });
    expect(parsed.ADMIN_PASSWORD).toBe("SuperSecretPassword123!");

    expect(() =>
      parseEnv({
        ...validBaseEnv,
        ADMIN_PASSWORD: "short",
      }),
    ).toThrow("Invalid server environment configuration: ADMIN_PASSWORD");
  });

  it("validates WEBHOOK_SIGNING_ENCRYPTION_KEY format when provided", () => {
    const validKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const parsed = parseEnv({
      ...validBaseEnv,
      WEBHOOK_SIGNING_ENCRYPTION_KEY: validKey,
    });
    expect(parsed.WEBHOOK_SIGNING_ENCRYPTION_KEY).toBe(validKey);

    expect(() =>
      parseEnv({
        ...validBaseEnv,
        WEBHOOK_SIGNING_ENCRYPTION_KEY: "not-hex-and-too-short",
      }),
    ).toThrow("Invalid server environment configuration: WEBHOOK_SIGNING_ENCRYPTION_KEY");
  });

  it("requires PUBLIC_URL in production instead of silently defaulting to localhost", () => {
    const { PUBLIC_URL: _omitted, ...withoutUrl } = validBaseEnv;
    expect(() => parseEnv({ ...withoutUrl, NODE_ENV: "production" })).toThrow("PUBLIC_URL");
    expect(parseEnv(withoutUrl).PUBLIC_URL).toBe("http://localhost:18787");
  });
});

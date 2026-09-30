import { app } from "@agent/app";
import { afterEach, expect, spyOn, test } from "bun:test";

import { loadTomlConfig, saveTomlConfig } from "@pockrew/pwr-core";
import type { AgentUpdateStatus } from "@pockrew/pwr-shared/schemas";

const call = async (path: string, method = "GET", body?: unknown) => {
  const response = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as { data: AgentUpdateStatus };
  return { status: response.status, data: json.data };
};

afterEach(() => saveTomlConfig({ ...loadTomlConfig(), updates: { mode: "manual" } }));

test("status explains why a source run cannot update itself", async () => {
  const { data } = await call("/updates");
  expect(data).toMatchObject({ mode: "manual", state: "idle", updateAvailable: false });
  expect(data.unsupportedReason).toContain("source");
  // The reinstall fallback matches the agent's platform, not the browser's.
  expect(data.installCommand).toContain(
    process.platform === "win32" ? "install.ps1" : "install.sh",
  );
  expect((await app.request("/updates/apply", { method: "POST" })).status).toBe(409);
});

test("a check records the latest release, and a failed check stays opaque", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json({
      tag_name: "v99.0.0",
      html_url: "https://github.com/pockrew/pwr/releases/tag/v99.0.0",
    }),
  );
  try {
    const { data } = await call("/updates/check", "POST");
    expect(data).toMatchObject({ latestVersion: "99.0.0", updateAvailable: true, lastError: null });
    fetchSpy.mockRejectedValueOnce(new Error("connect ECONNREFUSED http://user:secret@proxy:3128"));
    const failed = (await call("/updates/check", "POST")).data;
    expect(failed.lastError).toContain("GitHub is unreachable");
    expect(failed.lastError).not.toContain("secret");
  } finally {
    fetchSpy.mockRestore();
  }
});

test("the update mode is saved to config.toml", async () => {
  const { data } = await call("/updates/config", "PUT", { mode: "auto" });
  expect(data.mode).toBe("auto");
  expect(loadTomlConfig().updates.mode).toBe("auto");
  expect((await call("/updates/config", "PUT", { mode: "never" })).data.mode).toBe("never");
  expect(loadTomlConfig().updates.mode).toBe("never");
  expect((await call("/updates/config", "PUT", { mode: "sometimes" })).status).toBe(400);
});

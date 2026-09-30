import { describe, expect, it } from "bun:test";

import {
  DEFAULT_PROXY_CONFIG,
  isHostBypassingProxy,
  resolveProxyUrl,
  type IProxyConfig,
} from "./proxy-resolver";

describe("Proxy Resolver & Bypass Logic", () => {
  it("strictly bypasses loopback targets to prevent localhost trap", () => {
    expect(isHostBypassingProxy("localhost")).toBe(true);
    expect(isHostBypassingProxy("127.0.0.1")).toBe(true);
    expect(isHostBypassingProxy("::1")).toBe(true);
    expect(isHostBypassingProxy("0.0.0.0")).toBe(true);
    expect(isHostBypassingProxy("app.localhost")).toBe(true);
  });

  it("handles domain wildcard bypass matching", () => {
    const noProxy = "localhost,127.0.0.1,.corp.internal,*.internal.net";
    expect(isHostBypassingProxy("service.corp.internal", noProxy)).toBe(true);
    expect(isHostBypassingProxy("corp.internal", noProxy)).toBe(true);
    expect(isHostBypassingProxy("api.internal.net", noProxy)).toBe(true);
    expect(isHostBypassingProxy("external.com", noProxy)).toBe(false);
  });

  it("returns undefined when proxy mode is disabled", () => {
    const config: IProxyConfig = {
      mode: "disabled",
      httpsProxy: "http://proxy.corp:8080",
      noProxy: "localhost,127.0.0.1",
    };
    expect(resolveProxyUrl("https://pwr.example.com", config)).toBeUndefined();
  });

  it("returns undefined for localhost target even when manual proxy is configured", () => {
    const config: IProxyConfig = {
      mode: "manual",
      httpsProxy: "http://proxy.corp:8080",
      noProxy: "localhost,127.0.0.1,::1",
    };
    expect(resolveProxyUrl("http://localhost:3000/webhook", config)).toBeUndefined();
    expect(resolveProxyUrl("http://127.0.0.1:3000/webhook", config)).toBeUndefined();
  });

  it("resolves https proxy for remote secure targets in manual mode", () => {
    const config: IProxyConfig = {
      mode: "manual",
      httpProxy: "http://http-proxy:8080",
      httpsProxy: "http://https-proxy:8443",
      noProxy: "localhost,127.0.0.1",
    };
    expect(resolveProxyUrl("https://api.github.com", config)).toBe("http://https-proxy:8443");
    expect(resolveProxyUrl("wss://pwr.example.com/ws", config)).toBe("http://https-proxy:8443");
    expect(resolveProxyUrl("http://insecure.site.com", config)).toBe("http://http-proxy:8080");
  });

  it("uses default configuration with safe loopback bypass", () => {
    expect(DEFAULT_PROXY_CONFIG.mode).toBe("auto");
    expect(DEFAULT_PROXY_CONFIG.noProxy).toContain("localhost");
  });
});

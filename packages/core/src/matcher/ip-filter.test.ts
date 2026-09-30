import { describe, expect, it } from "bun:test";

import { createIpFilter, isIpInCidr, parseCidr, parseIpList } from "./ip-filter";

describe("IP Filter & CIDR Matcher", () => {
  it("matches exact IPv4 and IPv6 addresses", () => {
    expect(isIpInCidr("192.168.1.50", "192.168.1.50")).toBe(true);
    expect(isIpInCidr("192.168.1.50", "192.168.1.51")).toBe(false);
    expect(isIpInCidr("::1", "::1")).toBe(true);
    expect(isIpInCidr("::1", "::2")).toBe(false);
  });

  it("matches IPv4 within CIDR subnets", () => {
    // /24 subnet: 192.168.1.0 - 192.168.1.255
    expect(isIpInCidr("192.168.1.1", "192.168.1.0/24")).toBe(true);
    expect(isIpInCidr("192.168.1.254", "192.168.1.0/24")).toBe(true);
    expect(isIpInCidr("192.168.2.1", "192.168.1.0/24")).toBe(false);

    // /16 subnet: 10.50.0.0 - 10.50.255.255
    expect(isIpInCidr("10.50.12.34", "10.50.0.0/16")).toBe(true);
    expect(isIpInCidr("10.51.12.34", "10.50.0.0/16")).toBe(false);

    // /8 subnet: 10.0.0.0 - 10.255.255.255
    expect(isIpInCidr("10.123.45.67", "10.0.0.0/8")).toBe(true);
    expect(isIpInCidr("11.0.0.1", "10.0.0.0/8")).toBe(false);

    // /32 single host
    expect(isIpInCidr("3.18.12.63", "3.18.12.63/32")).toBe(true);
    expect(isIpInCidr("3.18.12.64", "3.18.12.63/32")).toBe(false);

    // /0 all IPv4 addresses
    expect(isIpInCidr("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(isIpInCidr("192.168.1.1", "0.0.0.0/0")).toBe(true);
  });

  it("parses comma/whitespace separated IP lists", () => {
    const parsed = parseIpList(" 192.168.1.1, 10.0.0.0/8 ; 172.16.0.0/12   3.18.12.63 ");
    expect(parsed).toEqual(["192.168.1.1", "10.0.0.0/8", "172.16.0.0/12", "3.18.12.63"]);
  });

  it("enforces denylist with priority over allowlist", () => {
    const filter = createIpFilter({
      allowlist: ["10.0.0.0/8", "192.168.1.0/24"],
      denylist: ["10.0.0.5", "192.168.1.100/32"],
    });

    // Allowed in subnet and not denied
    expect(filter.isAllowed("10.0.0.1")).toBe(true);
    expect(filter.isAllowed("192.168.1.50")).toBe(true);

    // In allowed subnet BUT explicitly denied -> must be rejected
    expect(filter.isAllowed("10.0.0.5")).toBe(false);
    expect(filter.isAllowed("192.168.1.100")).toBe(false);

    // Not in allowlist -> must be rejected
    expect(filter.isAllowed("8.8.8.8")).toBe(false);
  });

  it("allows all traffic when allowlist is empty and not in denylist", () => {
    const filter = createIpFilter({
      denylist: ["1.2.3.4"],
    });

    expect(filter.isAllowed("8.8.8.8")).toBe(true);
    expect(filter.isAllowed("1.2.3.4")).toBe(false);
  });

  it("handles malformed IPs and CIDRs gracefully without throwing", () => {
    expect(parseCidr("invalid-ip")).toBeNull();
    expect(parseCidr("192.168.1.1/99")).toBeNull();
    expect(isIpInCidr("invalid-ip", "10.0.0.0/8")).toBe(false);
    expect(isIpInCidr("10.0.0.1", "invalid-cidr")).toBe(false);
  });
});

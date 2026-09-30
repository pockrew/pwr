import { expect, test } from "bun:test";

import { compareVersions } from "@pockrew/pwr-shared/libs";

test("compareVersions orders releases and prereleases", () => {
  expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
  expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.10.0", "1.9.3")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  expect(compareVersions("1.0.0-rc.10", "1.0.0-rc.2")).toBeGreaterThan(0);
  expect(compareVersions("0.1.0-dev", "0.1.0")).toBeLessThan(0);
});

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

import { installRelease } from "./service";

const release = { tag: "v9.0.0", version: "9.0.0", url: "https://example.test/release" };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
let dir: string;

/** Serve SHA256SUMS and the two binaries of a fake release. */
const mockRelease = (assets: Record<string, string>, sums: Record<string, string>) => {
  const serve = async (input: string | URL | Request): Promise<Response> => {
    const name = String(input).split("/").at(-1) ?? "";
    if (name === "SHA256SUMS")
      return new Response(
        Object.entries(sums)
          .map(([asset, digest]) => `${digest}  ${asset}`)
          .join("\n"),
      );
    const body = assets[name];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  };
  return spyOn(globalThis, "fetch").mockImplementation(serve as typeof fetch);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pwr-update-"));
  writeFileSync(join(dir, "pwr-agent"), "old agent");
  writeFileSync(join(dir, "pwr"), "old cli");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const binaries = () => [
  { asset: "pwr-agent-test", path: join(dir, "pwr-agent") },
  { asset: "pwr-test", path: join(dir, "pwr") },
];

test("verified binaries replace the installed ones and become executable", async () => {
  const assets = { "pwr-agent-test": "new agent", "pwr-test": "new cli" };
  const fetchSpy = mockRelease(assets, {
    "pwr-agent-test": sha("new agent"),
    "pwr-test": sha("new cli"),
  });
  try {
    await installRelease(release, binaries(), () => {});
  } finally {
    fetchSpy.mockRestore();
  }
  expect(readFileSync(join(dir, "pwr-agent"), "utf8")).toBe("new agent");
  expect(readFileSync(join(dir, "pwr"), "utf8")).toBe("new cli");
  expect(statSync(join(dir, "pwr")).mode & 0o111).toBeTruthy();
  expect(readdirSync(dir).sort()).toEqual(["pwr", "pwr-agent"]);
});

test("a checksum mismatch replaces nothing and leaves no temporary files", async () => {
  const assets = { "pwr-agent-test": "new agent", "pwr-test": "tampered cli" };
  const fetchSpy = mockRelease(assets, {
    "pwr-agent-test": sha("new agent"),
    "pwr-test": sha("new cli"),
  });
  try {
    await expect(installRelease(release, binaries(), () => {})).rejects.toThrow(
      "checksum mismatch for pwr-test",
    );
  } finally {
    fetchSpy.mockRestore();
  }
  expect(readFileSync(join(dir, "pwr-agent"), "utf8")).toBe("old agent");
  expect(readFileSync(join(dir, "pwr"), "utf8")).toBe("old cli");
  expect(readdirSync(dir).sort()).toEqual(["pwr", "pwr-agent"]);
});

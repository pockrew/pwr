// Release builds define this constant (`bun build --define`, Vite `define`); dev runs fall back.
declare const __PWR_VERSION__: string | undefined;

/** Product version shown by the CLI, agent, MCP server and Studio. */
export const PWR_VERSION: string =
  typeof __PWR_VERSION__ === "string" ? __PWR_VERSION__ : "0.1.0-dev";

/** Public source repository (owner/name) that publishes release binaries and SHA256SUMS. */
export const PWR_REPOSITORY = "pockrew/pwr";

const parseVersion = (version: string): [number[], string | null] => {
  const [core = "", prerelease] = version.replace(/^v/, "").split("-", 2);
  return [core.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease ?? null];
};

/**
 * Compare `major.minor.patch[-prerelease]` versions; a prerelease sorts before its release.
 * @returns Negative when `a` is older than `b`, 0 when equal, positive when newer.
 */
export const compareVersions = (a: string, b: string): number => {
  const [coreA, preA] = parseVersion(a);
  const [coreB, preB] = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0);
    if (diff) return diff;
  }
  if (preA === preB) return 0;
  if (preA === null) return 1;
  if (preB === null) return -1;
  return preA.localeCompare(preB, "en", { numeric: true });
};

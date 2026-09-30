import { PWR_REPOSITORY } from "./version";

/** Platforms with published release binaries, named `<os>-<arch>` like Bun's compile targets. */
export const RELEASE_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "windows-x64",
  "windows-arm64",
] as const;

/** One published platform, e.g. `linux-x64` or `windows-arm64`. */
export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];

/**
 * Release target for a Node `process.platform` / `process.arch` pair.
 * @returns The target, or null when no binaries are published for that platform.
 */
export const releaseTargetOf = (platform: string, arch: string): ReleaseTarget | null => {
  const name = `${platform === "win32" ? "windows" : platform}-${arch}`;
  return RELEASE_TARGETS.find((target) => target === name) ?? null;
};

/** Release asset name of a binary, e.g. `pwr-agent-linux-x64` or `pwr-windows-x64.exe`. */
export const releaseAssetName = (binary: "pwr" | "pwr-agent", target: ReleaseTarget): string =>
  `${binary}-${target}${target.startsWith("windows-") ? ".exe" : ""}`;

/**
 * One-line installer (downloads a verified release binary); the fallback when self-update cannot
 * run. PowerShell on Windows, a shell script everywhere else.
 */
export const pwrInstallCommand = (windows: boolean): string =>
  windows
    ? `irm https://raw.githubusercontent.com/${PWR_REPOSITORY}/main/install.ps1 | iex`
    : `curl -fsSL https://raw.githubusercontent.com/${PWR_REPOSITORY}/main/install.sh | bash`;

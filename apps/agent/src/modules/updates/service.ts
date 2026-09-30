import { accessSync, chmodSync, constants, existsSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { requestLifecycle } from "@agent/platform/lifecycle";
import { getLogger } from "@logtape/logtape";
import { HTTPException } from "hono/http-exception";

import { loadTomlConfig } from "@pockrew/pwr-core";
import { compareVersions, PWR_VERSION } from "@pockrew/pwr-shared/libs";
import type { AgentUpdateStatus } from "@pockrew/pwr-shared/schemas";

import {
  downloadAsset,
  fetchChecksums,
  fetchLatestRelease,
  releaseAssetUrl,
  type IRelease,
} from "./release";

const logger = getLogger(["pwr", "agent", "update"]);

const RELEASE_TARGETS = new Set(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"]);
const FIRST_CHECK_DELAY_MS = 60_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const target = `${process.platform}-${process.arch}`;

let latest: IRelease | null = null;
let checkedAt: string | null = null;
let lastError: string | null = null;
let state: AgentUpdateStatus["state"] = "idle";
let progress: AgentUpdateStatus["progress"] = null;

/** Why this install cannot replace its own binaries, or null when it can. */
const unsupportedReason = (): string | null => {
  if (basename(process.execPath).startsWith("bun"))
    return "The agent runs from source; update the checkout instead.";
  if (PWR_VERSION.endsWith("-dev")) return "Development builds do not update themselves.";
  if (!RELEASE_TARGETS.has(target)) return `No release binaries are published for ${target}.`;
  try {
    accessSync(dirname(process.execPath), constants.W_OK);
    return null;
  } catch {
    return `${dirname(process.execPath)} is not writable; re-run the installer.`;
  }
};

const isNewer = (release: IRelease | null): release is IRelease =>
  release !== null && compareVersions(release.version, PWR_VERSION) > 0;

/** Current version, the last check result, the configured mode and any update in progress. */
export const updateStatus = (): AgentUpdateStatus => ({
  currentVersion: PWR_VERSION,
  latestVersion: latest?.version ?? null,
  updateAvailable: isNewer(latest),
  releaseUrl: latest?.url ?? null,
  checkedAt,
  lastError,
  mode: loadTomlConfig().updates.mode,
  state,
  progress,
  unsupportedReason: unsupportedReason(),
});

/** Ask GitHub for the latest release; a failure is recorded in `lastError`, not thrown. */
export const checkForUpdate = async (): Promise<AgentUpdateStatus> => {
  if (state !== "idle") return updateStatus();
  state = "checking";
  try {
    latest = await fetchLatestRelease();
    lastError = null;
  } catch (error) {
    lastError = `Update check failed: ${error instanceof Error ? error.message : "unknown error"}`;
    logger.warning(lastError);
  } finally {
    checkedAt = new Date().toISOString();
    state = "idle";
  }
  return updateStatus();
};

/** Binaries an update replaces: this agent and the `pwr` CLI beside it, when present. */
const installedBinaries = (): { asset: string; path: string }[] => {
  const cli = join(dirname(process.execPath), "pwr");
  return [
    { asset: `pwr-agent-${target}`, path: process.execPath },
    ...(existsSync(cli) ? [{ asset: `pwr-${target}`, path: cli }] : []),
  ];
};

/**
 * Replace installed binaries with a verified release.
 * 1. Checksums first: a release without these assets stops before any download.
 * 2. Each binary downloads beside its target (same filesystem) and must match SHA256SUMS.
 * 3. Renames happen only after every download verified; a running process keeps its old inode.
 * @param binaries - Release asset name and installed path of each binary to replace.
 * @param onProgress - Download progress of the current asset.
 */
export const installRelease = async (
  release: IRelease,
  binaries: { asset: string; path: string }[],
  onProgress: (progress: NonNullable<AgentUpdateStatus["progress"]>) => void,
): Promise<void> => {
  const checksums = await fetchChecksums(release.tag);
  const staged: { temp: string; path: string }[] = [];
  try {
    for (const { asset, path } of binaries) {
      const expected = checksums.get(asset);
      if (!expected) throw new Error(`the release has no ${asset}`);
      const temp = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.update`);
      staged.push({ temp, path });
      const digest = await downloadAsset(
        releaseAssetUrl(release.tag, asset),
        temp,
        (receivedBytes, totalBytes) => onProgress({ asset, receivedBytes, totalBytes }),
      );
      if (digest !== expected) throw new Error(`checksum mismatch for ${asset}`);
      chmodSync(temp, 0o755);
    }
    for (const { temp, path } of staged) renameSync(temp, path);
  } finally {
    for (const { temp } of staged) rmSync(temp, { force: true });
  }
};

/**
 * Start installing the latest known release in the background; poll `updateStatus` for progress.
 * @throws HTTPException 409 when this install cannot update, one is running, or none is newer.
 */
export const startUpdate = (): AgentUpdateStatus => {
  const release = latest;
  if (unsupportedReason() || state !== "idle" || !isNewer(release)) throw new HTTPException(409);
  state = "downloading";
  lastError = null;
  progress = null;
  logger.info("Updating v{from} to v{to}", { from: PWR_VERSION, to: release.version });
  // Restart into the new binaries on the graceful path; launchd/systemd relaunch a service.
  const install = async () => {
    await installRelease(release, installedBinaries(), (next) => {
      progress = next;
    });
    state = "restarting";
    logger.info("Installed v{version}; restarting", { version: release.version });
    await requestLifecycle("restart");
  };
  void install().catch((error: unknown) => {
    lastError = `Update to v${release.version} failed: ${error instanceof Error ? error.message : "unknown error"}`;
    state = "idle";
    progress = null;
    logger.error(lastError);
  });
  return updateStatus();
};

/**
 * Daily release check (the first a minute after startup) for installs that can update. `auto`
 * mode installs a newer release right away, `manual` only records it for Studio and `pwr update`,
 * and `never` skips the check; the mode is re-read each time, so a change needs no restart.
 * @returns Stop function for shutdown.
 */
export const startUpdateTimer = (): (() => void) => {
  if (unsupportedReason()) return () => {};
  const run = async (): Promise<void> => {
    const { mode } = loadTomlConfig().updates;
    if (mode === "never") return;
    await checkForUpdate();
    if (mode === "auto" && isNewer(latest) && state === "idle") startUpdate();
  };
  const first = setTimeout(() => void run(), FIRST_CHECK_DELAY_MS);
  const interval = setInterval(() => void run(), CHECK_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
};

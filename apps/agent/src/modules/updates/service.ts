import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { requestLifecycle } from "@agent/platform/lifecycle";
import { getLogger } from "@logtape/logtape";
import { HTTPException } from "hono/http-exception";

import { loadTomlConfig } from "@pockrew/pwr-core";
import {
  compareVersions,
  PWR_VERSION,
  pwrInstallCommand,
  releaseAssetName,
  releaseTargetOf,
  type ReleaseTarget,
} from "@pockrew/pwr-shared/libs";
import type { AgentUpdateStatus } from "@pockrew/pwr-shared/schemas";

import {
  downloadAsset,
  fetchChecksums,
  fetchLatestRelease,
  releaseAssetUrl,
  type IRelease,
} from "./release";

const logger = getLogger(["pwr", "agent", "update"]);

const FIRST_CHECK_DELAY_MS = 60_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const target = releaseTargetOf(process.platform, process.arch);
const isWindows = process.platform === "win32";

let latest: IRelease | null = null;
let checkedAt: string | null = null;
let lastError: string | null = null;
let state: AgentUpdateStatus["state"] = "idle";
let progress: AgentUpdateStatus["progress"] = null;

const runsFromSource = (): boolean => basename(process.execPath).startsWith("bun");

/**
 * Whether this process can create files in `dir`. Windows `access()` checks only the read-only
 * attribute, not ACLs, so there a probe file is written instead.
 */
const canWriteTo = (dir: string): boolean => {
  try {
    if (!isWindows) {
      accessSync(dir, constants.W_OK);
      return true;
    }
    const probe = join(dir, `.pwr-write-probe-${process.pid}`);
    writeFileSync(probe, "");
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
};

/** Why this install cannot replace its own binaries, or null when it can. */
const unsupportedReason = (): string | null => {
  if (runsFromSource()) return "The agent runs from source; update the checkout instead.";
  if (PWR_VERSION.endsWith("-dev")) return "Development builds do not update themselves.";
  if (!target) return `No release binaries are published for ${process.platform}-${process.arch}.`;
  if (!canWriteTo(dirname(process.execPath)))
    return `${dirname(process.execPath)} is not writable; re-run the installer.`;
  return null;
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
  installCommand: pwrInstallCommand(isWindows),
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

/** The `pwr` CLI installed beside this agent (`pwr.exe` on Windows). */
const cliPath = (): string => join(dirname(process.execPath), isWindows ? "pwr.exe" : "pwr");

/** Binaries an update replaces: this agent and the `pwr` CLI beside it, when present. */
const installedBinaries = (platform: ReleaseTarget): { asset: string; path: string }[] => [
  { asset: releaseAssetName("pwr-agent", platform), path: process.execPath },
  ...(existsSync(cliPath()) ? [{ asset: releaseAssetName("pwr", platform), path: cliPath() }] : []),
];

/** Where a replaced binary is moved when it cannot be overwritten while it runs. */
const replacedPath = (path: string): string => `${path}.old`;

/**
 * Swap verified downloads into place, all or nothing. Windows cannot overwrite a running
 * executable but can rename it, so there each old binary first moves aside to `.old`.
 * 1. Per binary: drop a stale `.old`, move the installed one aside, move the download in.
 * 2. On any failure, every binary already touched is restored before the error is rethrown, so
 *    a failed update never leaves an install without its agent or CLI.
 */
const swapIntoPlace = (staged: { temp: string; path: string }[]): void => {
  const touched: { path: string; movedAside: boolean; placed: boolean }[] = [];
  try {
    for (const { temp, path } of staged) {
      const step = { path, movedAside: false, placed: false };
      touched.push(step);
      rmSync(replacedPath(path), { force: true });
      if (existsSync(path)) {
        renameSync(path, replacedPath(path));
        step.movedAside = true;
      }
      renameSync(temp, path);
      step.placed = true;
    }
  } catch (error) {
    for (const { path, movedAside, placed } of touched.toReversed()) {
      try {
        if (placed) rmSync(path, { force: true });
        if (movedAside) renameSync(replacedPath(path), path);
      } catch (restoreError) {
        logger.error("Could not restore {path}: {error}", { path, error: restoreError });
      }
    }
    throw error;
  }
};

/**
 * Delete binaries a previous Windows update moved aside. A file still in use (the `pwr update`
 * process that started the update may still be running) stays until a later start.
 */
export const removeReplacedBinaries = (): void => {
  if (!isWindows || runsFromSource()) return;
  for (const path of [process.execPath, cliPath()]) {
    try {
      rmSync(replacedPath(path), { force: true });
    } catch (error) {
      logger.warning("Could not remove {path}: {error}", { path: replacedPath(path), error });
    }
  }
};

/**
 * Replace installed binaries with a verified release.
 * 1. Checksums first: a release without these assets stops before any download.
 * 2. Each binary downloads beside its target (same filesystem) and must match SHA256SUMS.
 * 3. Renames happen only after every download verified; a running process keeps its old inode,
 *    or on Windows keeps running from the renamed-aside file.
 * @param binaries - Release asset name and installed path of each binary to replace.
 * @param onProgress - Download progress of the current asset.
 * @param renameRunning - Move each old binary aside before replacing it (required on Windows).
 */
export const installRelease = async (
  release: IRelease,
  binaries: { asset: string; path: string }[],
  onProgress: (progress: NonNullable<AgentUpdateStatus["progress"]>) => void,
  renameRunning = isWindows,
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
    if (renameRunning) swapIntoPlace(staged);
    else for (const { temp, path } of staged) renameSync(temp, path);
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
  if (!target || unsupportedReason() || state !== "idle" || !isNewer(release))
    throw new HTTPException(409);
  state = "downloading";
  lastError = null;
  progress = null;
  logger.info("Updating v{from} to v{to}", { from: PWR_VERSION, to: release.version });
  // Restart into the new binaries on the graceful path; launchd/systemd relaunch a service.
  const install = async () => {
    await installRelease(release, installedBinaries(target), (next) => {
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

import { createHash } from "node:crypto";
import { relayTransportOptions } from "@agent/modules/relays/client";
import { z } from "zod";

import { PWR_REPOSITORY, PWR_VERSION } from "@pockrew/pwr-shared/libs";

const LatestReleaseSchema = z.object({ tag_name: z.string(), html_url: z.url() });
const RELEASE_TAG = /^v?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/;

/** A published release: `tag` names its download path, `version` is comparable. */
export interface IRelease {
  tag: string;
  version: string;
  url: string;
}

/**
 * GitHub request through the agent's proxy/CA settings. Network failures get a fixed message so
 * proxy URLs (which may embed credentials) never reach API responses or logs.
 */
const githubFetch = async (url: string, timeoutMs: number): Promise<Response> => {
  try {
    return await fetch(url, {
      headers: { "user-agent": `pwr-agent/${PWR_VERSION}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(timeoutMs),
      ...relayTransportOptions(url),
    });
  } catch {
    throw new Error("GitHub is unreachable; check the network and proxy settings");
  }
};

/** Latest published release of the PWR repository. */
export const fetchLatestRelease = async (): Promise<IRelease> => {
  const response = await githubFetch(
    `https://api.github.com/repos/${PWR_REPOSITORY}/releases/latest`,
    10_000,
  );
  if (response.status === 404) throw new Error(`${PWR_REPOSITORY} has no published release yet`);
  if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`);
  const release = LatestReleaseSchema.safeParse(await response.json().catch(() => null));
  const version = release.success ? RELEASE_TAG.exec(release.data.tag_name)?.[1] : undefined;
  if (!release.success || !version) throw new Error("GitHub returned an unexpected release");
  return { tag: release.data.tag_name, version, url: release.data.html_url };
};

/** Download URL of one asset of a release. */
export const releaseAssetUrl = (tag: string, asset: string): string =>
  `https://github.com/${PWR_REPOSITORY}/releases/download/${tag}/${asset}`;

/** The release's SHA256SUMS as asset name → hex digest. */
export const fetchChecksums = async (tag: string): Promise<Map<string, string>> => {
  const response = await githubFetch(releaseAssetUrl(tag, "SHA256SUMS"), 30_000);
  if (!response.ok) throw new Error(`SHA256SUMS download failed (HTTP ${response.status})`);
  const entries = (await response.text()).split("\n").flatMap((line): [string, string][] => {
    const [digest, name] = line.trim().split(/\s+/);
    return digest && name ? [[name, digest]] : [];
  });
  return new Map(entries);
};

/**
 * Stream a release asset to `path`, hashing it on the way.
 * @param onProgress - Received and total bytes (total null when the server omits it).
 * @returns SHA-256 hex digest of the written file.
 */
export const downloadAsset = async (
  url: string,
  path: string,
  onProgress: (receivedBytes: number, totalBytes: number | null) => void,
): Promise<string> => {
  const response = await githubFetch(url, 15 * 60_000);
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`);
  const totalBytes = Number(response.headers.get("content-length")) || null;
  const hash = createHash("sha256");
  const writer = Bun.file(path).writer();
  let receivedBytes = 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      writer.write(chunk);
      receivedBytes += chunk.byteLength;
      onProgress(receivedBytes, totalBytes);
    }
  } finally {
    await writer.end();
  }
  return hash.digest("hex");
};

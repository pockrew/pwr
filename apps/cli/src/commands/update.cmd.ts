import { formatBytes } from "@pockrew/pwr-core";
import type { AgentUpdateMode, AgentUpdateStatus } from "@pockrew/pwr-shared/schemas";

import {
  checkAgentHealth,
  createAgentRpcClient,
  ensureAgentDaemonRunning,
  type AgentRpcClient,
} from "~/client/daemon.client";
import { colorize, colors } from "~/ui/ansi";

const RESTART_TIMEOUT_MS = 60_000;

const UPDATE_MODE_TEXT: Record<AgentUpdateMode, string> = {
  auto: "automatic (new releases install and restart the agent)",
  manual: "manual (checked daily; run `pwr update` to install)",
  never: "never checked automatically (run `pwr update` to check and install)",
};

export interface IUpdateCommandOptions {
  port?: number | undefined;
  /** Only report whether a newer release exists. */
  checkOnly: boolean;
  /** Change the update mode instead of updating. */
  mode?: AgentUpdateMode | undefined;
}

/** Unwrap the agent's `{ data }` envelope; a non-2xx answer becomes an error. */
const readStatus = async (response: {
  ok: boolean;
  status: number;
  json(): Promise<{ data: AgentUpdateStatus }>;
}): Promise<AgentUpdateStatus> => {
  if (!response.ok) throw new Error(`The agent refused the request (HTTP ${response.status})`);
  return (await response.json()).data;
};

/** Show download progress until the agent starts restarting; throws when the install fails. */
const waitForInstall = async (client: AgentRpcClient): Promise<void> => {
  for (;;) {
    await Bun.sleep(500);
    const status = await readStatus(await client.updates.$get()).catch(() => null);
    // The agent stops answering once it shuts down to restart into the new binaries.
    if (!status || status.state === "restarting") break;
    if (status.state === "idle") throw new Error(status.lastError ?? "The update stopped");
    const { progress } = status;
    if (progress)
      process.stdout.write(
        `\r  ${progress.asset} ${formatBytes(progress.receivedBytes)}${progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}   `,
      );
  }
  process.stdout.write("\n");
};

/**
 * `pwr update [--check] [--mode auto|manual]`: the agent checks GitHub, downloads and verifies
 * the release binaries (agent with Studio, and this CLI beside it), swaps them and restarts.
 * @param options - Port, check-only flag or new update mode.
 */
export const executeUpdateCommand = async (options: IUpdateCommandOptions): Promise<void> => {
  if (!(await ensureAgentDaemonRunning(options.port)))
    throw new Error("The agent did not start; see `pwr agent logs`");
  const client = createAgentRpcClient(options.port);

  // 1. Mode change only.
  if (options.mode) {
    const status = await readStatus(
      await client.updates.config.$put({ json: { mode: options.mode } }),
    );
    console.log(`Updates: ${UPDATE_MODE_TEXT[status.mode]}`);
    return;
  }

  // 2. Check.
  const status = await readStatus(await client.updates.check.$post());
  if (status.lastError) throw new Error(status.lastError);
  if (!status.updateAvailable || !status.latestVersion) {
    console.log(colorize(`✔ pwr v${status.currentVersion} is up to date`, colors.brightGreen));
    return;
  }
  console.log(
    `Update available: v${status.currentVersion} → v${status.latestVersion} (${status.releaseUrl})`,
  );
  if (options.checkOnly) {
    console.log(colorize("Run `pwr update` to install it.", colors.dim));
    return;
  }
  if (status.unsupportedReason)
    throw new Error(`${status.unsupportedReason} To reinstall: ${status.installCommand}`);

  // 3. Install; the agent swaps binaries only after both downloads match SHA256SUMS.
  await readStatus(await client.updates.apply.$post());
  await waitForInstall(client);

  // 4. Success only once the restarted agent answers on the new version.
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await checkAgentHealth(options.port)).version === status.latestVersion) {
      console.log(colorize(`✔ Updated to v${status.latestVersion}`, colors.brightGreen));
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `The agent did not come back on v${status.latestVersion}; check \`pwr agent status\` and \`pwr agent logs\``,
  );
};

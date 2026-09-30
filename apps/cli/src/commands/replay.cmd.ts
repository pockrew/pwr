import {
  agentPort,
  agentReplayRequest,
  createAgentRpcClient,
  ensureAgentDaemonRunning,
} from "~/client/daemon.client";
import { colorize, colors } from "~/ui/ansi";

export interface IReplayCommandOptions {
  id: string;
  tunnelId?: string | undefined;
  projectId?: string | undefined;
  port?: number | undefined;
}

/**
 * CLI command controller that triggers a local replay of a stored webhook request through the Agent.
 *
 * @param options - Stored delivery identifier and Agent port.
 */
export const executeReplayCommand = async (options: IReplayCommandOptions): Promise<void> => {
  // 1. Ensure Agent daemon is active
  const isAgentRunning = await ensureAgentDaemonRunning(options.port);
  if (!isAgentRunning) {
    console.error(
      colorize(`✕ Agent daemon is offline on port ${agentPort(options.port)}`, colors.brightRed),
    );
    process.exit(1);
  }
  const port = agentPort(options.port);

  const client = createAgentRpcClient(port);

  // 2. Dispatch replay command to the Agent
  process.stdout.write(
    `${colorize("⠋", colors.brightCyan)} Replaying webhook ${colorize(options.id, colors.bold)}...\r`,
  );

  const result = await agentReplayRequest(client, options.id, {
    tunnelId: options.tunnelId,
    projectId: options.projectId,
  });

  // 3. Handle replay failure
  if (!result.success || !result.delivery) {
    console.error(
      `${colorize("✕ Replay failed:", colors.brightRed)} ${result.error ?? "Could not replay webhook"}`,
    );
    process.exit(1);
  }

  const delivery = result.delivery;

  // 4. Output structured replay execution telemetry
  const statusColor =
    delivery.statusCode && delivery.statusCode >= 200 && delivery.statusCode < 300
      ? colors.brightGreen
      : colors.brightRed;

  console.log(`\n${colorize("═══ REPLAY EXECUTION RESULT ═══", colors.bold)}`);
  console.log(`${colorize("Event ID:", colors.dim)} ${colorize(options.id, colors.bold)}`);
  console.log(
    `${colorize("Target URL:", colors.dim)} ${colorize(delivery.targetUrl, colors.brightBlue)}`,
  );
  console.log(
    `${colorize("HTTP Status:", colors.dim)} ${
      delivery.statusCode
        ? colorize(String(delivery.statusCode), statusColor)
        : colorize("NO RESPONSE", colors.brightRed)
    }`,
  );
  console.log(
    `${colorize("Duration:", colors.dim)} ${delivery.latencyMs !== undefined ? `${delivery.latencyMs}ms` : "-"}`,
  );

  if (delivery.responseBody) {
    console.log(`\n${colorize("--- Response Body ---", colors.bold)}`);
    try {
      const parsed = JSON.parse(delivery.responseBody);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(delivery.responseBody);
    }
  }
  console.log();
};

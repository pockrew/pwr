import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

import {
  agentConnectTunnel,
  agentPort,
  checkAgentHealth,
  createAgentRpcClient,
  describeTunnelError,
  ensureAgentDaemonRunning,
  getAgentTunnel,
  streamAgentEvents,
} from "~/client/daemon.client";
import { colorize, colors } from "~/ui/ansi";
import { formatDeliveryResultLine, formatWebhookEventLine } from "~/ui/stream";

export interface IConnectCommandOptions {
  tunnelId: string;
  slug: string;
  serverWsUrl: string;
  apiKey?: string | undefined;
  projectId: string;
  port?: number | undefined;
  /** Replace another agent that currently owns this tunnel. */
  takeover?: boolean;
}

/**
 * CLI command controller that connects a reverse webhook tunnel via the local Agent daemon
 * and streams real-time delivery logs to the terminal.
 *
 * @param options - Tunnel connection parameters.
 */
export const executeConnectCommand = async (options: IConnectCommandOptions): Promise<void> => {
  // 1. Ensure the background agent daemon is running
  process.stdout.write(`${colorize("⠋", colors.brightCyan)} Checking agent daemon...\r`);
  const isAgentRunning = await ensureAgentDaemonRunning(options.port);
  if (!isAgentRunning) {
    console.error(
      colorize(
        `✕ Failed to start agent daemon on port ${agentPort(options.port)}`,
        colors.brightRed,
      ),
    );
    process.exit(1);
  }
  const port = agentPort(options.port);

  // 2. Instantiate typed Hono RPC client
  const client = createAgentRpcClient(port);

  // 3. Dispatch tunnel connection request to the Agent daemon
  process.stdout.write(
    `${colorize("⠋", colors.brightCyan)} Connecting tunnel ${colorize(options.tunnelId, colors.bold)}...\r`,
  );
  const connectResult = await agentConnectTunnel(client, {
    tunnelId: options.tunnelId,
    slug: options.slug,
    serverWsUrl: options.serverWsUrl,
    apiKey: options.apiKey,
    projectId: options.projectId,
    ...(options.takeover ? { takeover: true } : {}),
  });

  if (!connectResult.success) {
    console.error(
      `${colorize("✕ Failed to connect tunnel:", colors.brightRed)} ${connectResult.message ?? "Unknown error"}`,
    );
    process.exit(1);
  }

  // 4. A 200 only means the Agent saved the connection intent; wait for server subscription.
  let state: "connected" | "pending" | "disconnected" = "pending";
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let tunnel;
    try {
      tunnel = await getAgentTunnel(client, options.tunnelId);
    } catch (error) {
      console.error(
        `${colorize("✕ Failed to inspect tunnel:", colors.brightRed)} ${error instanceof Error ? error.message : "Agent RPC failed"}`,
      );
      process.exit(1);
    }
    if (!tunnel) {
      console.error(colorize("✕ Agent no longer has this tunnel session.", colors.brightRed));
      process.exit(1);
    }
    lastError = describeTunnelError(tunnel.lastError);
    if (tunnel?.status === "connected") {
      state = "connected";
      break;
    }
    if (tunnel?.status === "disconnected") {
      state = "disconnected";
      break;
    }
    await Bun.sleep(250);
  }

  // 5. Output the observed state and local inspection URL.
  console.log(
    state === "connected"
      ? `${colorize("● Connected", colors.brightGreen)} to server tunnel: ${colorize(options.slug, colors.bold)}`
      : state === "disconnected"
        ? `${colorize("✕ Disconnected", colors.brightRed)} from server tunnel: ${colorize(options.slug, colors.bold)}`
        : `${colorize("○ Connection pending", colors.brightYellow)} for server tunnel: ${colorize(options.slug, colors.bold)} (Agent will retry; run pwr status to inspect)`,
  );
  if (state !== "connected" && lastError)
    console.log(colorize(`  ${lastError}`, colors.brightYellow));
  const health = await checkAgentHealth(port);
  if (health.status === "storage_blocked") {
    console.log(
      colorize(
        `⚠ Agent storage blocked (${health.storage?.reason ?? "unknown"}); new deliveries are paused until safe cleanup.`,
        colors.brightYellow,
      ),
    );
  }
  console.log(
    `${colorize("🌐 Web Studio:", colors.brightCyan)} ${colorize(`http://127.0.0.1:${port}`, colors.bold)}`,
  );
  console.log(
    `${colorize("⚡ Log Stream:", colors.dim)} Listening for incoming webhooks... (Ctrl+C closes this view; Agent keeps running)\n`,
  );

  // 6. Connect to Agent's local SSE stream; its status is not the server tunnel state.
  const controller = streamAgentEvents(
    port,
    options.tunnelId,
    (event: WebhookEvent) => {
      // 7. Format each incoming webhook delivery line with ANSI styling
      console.log(formatWebhookEventLine(event));
    },
    (status) => {
      if (status === "reconnecting") {
        console.log(`${colorize("○ Reconnecting local log stream...", colors.brightYellow)}`);
      } else if (status === "disconnected") {
        console.log(`${colorize("✕ Local log stream disconnected.", colors.brightRed)}`);
      }
    },
    (result) => console.log(formatDeliveryResultLine(result)),
  );

  // 8. Register termination signal handlers for graceful exit
  const handleExit = () => {
    controller.abort();
    console.log(`\n${colorize("👋 Disconnected from log stream.", colors.dim)}`);
    process.exit(0);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);
};

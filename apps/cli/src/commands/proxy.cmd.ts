import {
  agentGetProxy,
  agentPort,
  agentSetProxy,
  createAgentRpcClient,
  ensureAgentDaemonRunning,
} from "~/client/daemon.client";
import { colorize, colors } from "~/ui/ansi";

export interface IProxyCommandOptions {
  action?: "status" | "set" | undefined;
  mode?: "auto" | "manual" | "disabled" | undefined;
  httpProxy?: string | undefined;
  httpsProxy?: string | undefined;
  noProxy?: string | undefined;
  caCertPath?: string | undefined;
  port?: number | undefined;
}

/**
 * CLI command controller that inspects or updates the corporate proxy configuration on the Agent daemon.
 *
 * @param options - Proxy command parameters.
 */
export const executeProxyCommand = async (options: IProxyCommandOptions): Promise<void> => {
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

  // 2. Set proxy branch
  if (
    options.action === "set" ||
    options.mode !== undefined ||
    options.httpProxy !== undefined ||
    options.httpsProxy !== undefined ||
    options.noProxy !== undefined ||
    options.caCertPath !== undefined
  ) {
    process.stdout.write(`${colorize("⠋", colors.brightCyan)} Updating agent proxy settings...\r`);
    const res = await agentSetProxy(client, {
      mode: options.mode,
      httpProxy: options.httpProxy,
      httpsProxy: options.httpsProxy,
      noProxy: options.noProxy,
      caCertPath: options.caCertPath,
    });

    if (!res || !res.success) {
      console.error(colorize("✕ Failed to update proxy settings.", colors.brightRed));
      process.exit(1);
    }

    console.log(colorize("✔ Proxy configuration updated successfully.", colors.brightGreen));
  }

  // 3. Status display branch: query active and detected proxy settings
  const proxyData = await agentGetProxy(client);
  if (!proxyData) {
    console.error(colorize("✕ Failed to retrieve proxy settings from Agent.", colors.brightRed));
    process.exit(1);
  }

  const config = proxyData.config ?? {};
  const detected = proxyData.detected ?? {};

  console.log(`\n${colorize("═══ AGENT PROXY CONFIGURATION ═══", colors.bold)}`);
  console.log(
    `${colorize("Mode:", colors.dim)} ${colorize(config.mode ?? "auto", colors.brightCyan)}`,
  );
  console.log(
    `${colorize("HTTP Proxy:", colors.dim)} ${config.httpProxy ?? colorize("(none)", colors.dim)}`,
  );
  console.log(
    `${colorize("HTTPS Proxy:", colors.dim)} ${config.httpsProxy ?? colorize("(none)", colors.dim)}`,
  );
  console.log(
    `${colorize("No Proxy:", colors.dim)} ${config.noProxy ?? "localhost,127.0.0.1,::1"}`,
  );
  console.log(
    `${colorize("Custom CA Cert:", colors.dim)} ${config.caCertPath ?? colorize("(none)", colors.dim)}`,
  );

  console.log(`\n${colorize("--- OS Auto-Detected Environment ---", colors.bold)}`);
  console.log(
    `${colorize("Detected HTTP:", colors.dim)} ${detected.httpProxy ?? colorize("(none)", colors.dim)}`,
  );
  console.log(
    `${colorize("Detected HTTPS:", colors.dim)} ${detected.httpsProxy ?? colorize("(none)", colors.dim)}`,
  );
  console.log(
    `${colorize("Detected No-Proxy:", colors.dim)} ${detected.noProxy ?? colorize("(none)", colors.dim)}`,
  );
  console.log();
};

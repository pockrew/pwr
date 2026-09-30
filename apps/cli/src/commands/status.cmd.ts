import { PWR_VERSION } from "@pockrew/pwr-shared/libs";

import {
  agentGetProxy,
  agentPort,
  checkAgentHealth,
  createAgentRpcClient,
  describeTunnelError,
  fetchAgentTunnels,
  type IAgentTunnelItem,
} from "~/client/daemon.client";
import { colorize, colors } from "~/ui/ansi";
import { renderBanner } from "~/ui/banner";
import { renderTable, type ITableColumn, type TableRow } from "~/ui/table";

/**
 * Formats a duration in seconds into a human-readable string (e.g. '12m 30s' or '1h 15m').
 *
 * @param seconds - Duration in seconds.
 * @returns Human-readable duration string.
 */
const formatDuration = (seconds?: number): string => {
  // 1. Guard against undefined or negative duration values
  if (seconds === undefined || seconds < 0) return "-";

  // 2. Format minutes and seconds for durations under 1 hour
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;

  // 3. Format hours and remaining minutes for longer durations
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
};

/**
 * CLI command controller that renders the system banner, proxy status, and active tunnel table.
 */
export const executeStatusCommand = async (pinned?: number): Promise<void> => {
  const port = agentPort(pinned);
  // 1. Read-only: report the agent's state, never start it as a side effect.
  const health = await checkAgentHealth(port);

  // 2. The Agent owns active proxy settings.
  const client = createAgentRpcClient(port);
  const proxy = health.online ? await agentGetProxy(client) : null;
  const proxyCfg = proxy?.config;
  const activeUrl =
    proxyCfg?.mode === "manual"
      ? (proxyCfg.httpsProxy ?? proxyCfg.httpProxy)
      : (proxy?.detected?.httpsProxy ?? proxy?.detected?.httpProxy);
  const proxyStatus = !proxyCfg
    ? colorize("⚪ Unknown", colors.dim)
    : proxyCfg.mode === "disabled"
      ? colorize("⚪ Direct (Disabled)", colors.dim)
      : `${colorize(proxyCfg.mode === "manual" ? "🔒 Manual" : "🔒 Auto", colors.brightGreen)} ${colorize(`(${activeUrl ?? "Direct"})`, colors.dim)}`;

  // 3. Render and print CLI header banner.
  const banner = renderBanner({
    version: health.version ?? PWR_VERSION,
    daemonStatus: health.online ? "online" : "offline",
    daemonPort: port,
    proxyStatus,
  });

  console.log("\n" + banner + "\n");

  // 5. Query active tunnel list from local agent daemon via RPC
  let tunnels: IAgentTunnelItem[] = [];
  if (health.online) {
    try {
      tunnels = await fetchAgentTunnels(client);
    } catch (error) {
      console.error(
        `${colorize("✕ Could not load Agent tunnels:", colors.brightRed)} ${error instanceof Error ? error.message : "RPC failure"}`,
      );
      process.exit(1);
    }
  }

  // 6. Format and display active tunnels table
  const columns: readonly ITableColumn[] = [
    { header: "#", key: "index", width: 3, align: "center" },
    { header: "TUNNEL", key: "tunnel", width: 14 },
    { header: "PROJECT", key: "project", width: 12 },
    { header: "SERVER SLUG", key: "slug", width: 26 },
    { header: "STATUS", key: "status", width: 14 },
    { header: "UPTIME", key: "uptime", width: 10, align: "right" },
  ];

  const now = Date.now();
  const rows: TableRow[] = tunnels.map((t, idx) => {
    const statusText =
      t.status === "connected"
        ? colorize("🟢 CONNECTED", colors.brightGreen)
        : t.status === "reconnecting"
          ? colorize("🟡 RECONNECT", colors.brightYellow)
          : colorize("🔴 OFFLINE", colors.brightRed);

    const uptimeSec = t.connectedAt ? Math.floor((now - t.connectedAt) / 1000) : 0;

    return {
      index: idx + 1,
      tunnel: colorize(t.tunnelId, colors.bold),
      project: colorize(t.projectId, colors.brightYellow),
      slug: t.slug ?? t.tunnelId,
      status: statusText,
      uptime: formatDuration(uptimeSec),
    };
  });

  console.log(
    `${colorize("ACTIVE TUNNELS", colors.bold)} ${colorize(`(${tunnels.length})`, colors.dim)}:`,
  );
  console.log(renderTable(columns, rows));
  for (const tunnel of tunnels) {
    const reason = describeTunnelError(tunnel.lastError);
    if (reason) console.log(colorize(`  ${tunnel.tunnelId}: ${reason}`, colors.brightYellow));
  }

  // 7. Output daemon metrics and operational action hints
  if (health.online) {
    console.log(
      `\n${colorize("Daemon Metrics:", colors.dim)} Uptime: ${formatDuration(health.uptimeSeconds)}`,
    );
    if (health.status === "storage_blocked") {
      console.log(
        colorize(
          `⚠ Storage blocked (${health.storage?.reason ?? "unknown"}); Agent is not accepting new deliveries. Run pwr clean after checking retention policy.`,
          colors.brightYellow,
        ),
      );
    }
  } else {
    console.log(
      `\n${colorize("Notice:", colors.yellow)} Daemon is currently stopped. Run ${colorize("pwr tunnel <name>", colors.brightCyan)} to launch.`,
    );
  }

  console.log(
    `\n${colorize("Actions:", colors.dim)} ${colorize("pwr inspect", colors.cyan)} (view requests) • ${colorize("pwr clean", colors.cyan)} (purge local db) • ${colorize("pwr proxy", colors.cyan)} (proxy config)\n`,
  );
};

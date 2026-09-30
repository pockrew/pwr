import { PWR_VERSION } from "@pockrew/pwr-shared/libs";

import { colorize, colors } from "./ansi";

export interface IBannerMeta {
  version?: string;
  serverUrl?: string;
  targetUrl?: string;
  daemonStatus?: "online" | "offline" | "reconnecting";
  daemonPort?: number;
  proxyStatus?: string;
}

/**
 * Renders the ASCII banner and terminal dashboard header displaying cluster, daemon, and proxy status.
 *
 * @param meta - Metadata configuration describing active profile, daemon port, and target routing.
 * @returns Multi-line formatted ANSI string suitable for terminal display.
 */
export const renderBanner = (meta: IBannerMeta = {}): string => {
  // 1. Resolve environment fallback values
  const version = meta.version ?? PWR_VERSION;
  const daemonStatus = meta.daemonStatus ?? "online";
  const daemonPort = meta.daemonPort ?? 18788;

  // 2. Format daemon status badge
  const statusBadge =
    daemonStatus === "online"
      ? colorize("🟢 ONLINE", colors.brightGreen)
      : daemonStatus === "reconnecting"
        ? colorize("🟡 RECONNECTING", colors.brightYellow)
        : colorize("🔴 OFFLINE", colors.brightRed);

  // 3. Assemble primary ASCII logo and system info lines
  const lines: string[] = [
    `${colorize(" █ █ █ █▀▀ █▀█", colors.brightCyan)}   ${colorize("pwr", colors.bold)} ${colorize(`v${version}`, colors.dim)} ${colorize("•", colors.dim)} ${colorize("local webhook relay", colors.dim)}`,
    `${colorize(" ▀▄▀▄▀ ▄██ █▀▄", colors.cyan)}   ${colorize("agent:", colors.dim)} ${statusBadge} ${colorize(`(127.0.0.1:${daemonPort})`, colors.dim)}`,
  ];

  // 4. Append optional proxy and destination targets if present
  if (meta.proxyStatus) {
    lines.push(`               ${colorize("proxy:", colors.dim)}   ${meta.proxyStatus}`);
  }

  if (meta.targetUrl) {
    lines.push(
      `               ${colorize("target:", colors.dim)}  ${colorize(meta.targetUrl, colors.brightBlue)}`,
    );
  }

  if (daemonStatus === "online") {
    lines.push(
      `               ${colorize("inspector:", colors.dim)} ${colorize(`http://127.0.0.1:${daemonPort}`, colors.brightCyan)}`,
    );
  }

  return lines.join("\n");
};

/**
 * Returns a compact colored CLI brand prefix for one-line log notices.
 *
 * @returns Styled mini logo string.
 */
export const renderMiniLogo = (): string => {
  return `${colorize("⚡ pwr", colors.brightCyan)}`;
};

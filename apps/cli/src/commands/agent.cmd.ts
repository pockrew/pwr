import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { agentFilePaths, formatLogEntry, readAgentToken, readLogPage } from "@pockrew/pwr-core";

import {
  agentDaemonPid,
  agentPort,
  checkAgentHealth,
  pinnedAgentPort,
  resolveAgentCommand,
  startAgentDaemon,
  stopAgentDaemon,
} from "~/client/daemon.lifecycle";
import { colorize, colors } from "~/ui/ansi";

const SERVICE_LABEL = "dev.pockrew.pwr-agent";
const launchAgentPath = () => join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
const systemdUnitPath = () => join(homedir(), ".config", "systemd", "user", "pwr-agent.service");

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Print the newest `limit` agent log entries, oldest first, as readable lines. */
const printLogs = async (limit: number): Promise<void> => {
  const { logFile, outputFile } = agentFilePaths();
  const page = await readLogPage(logFile, { limit });
  if (!page.exists) console.log(colorize(`No agent log yet at ${logFile}`, colors.dim));
  for (const entry of page.entries.toReversed()) console.log(formatLogEntry(entry));
  console.log(
    colorize(`\n  log: ${logFile}\n  process output (crashes): ${outputFile}`, colors.dim),
  );
};

/**
 * Write a per-user autostart unit (launchd on macOS, systemd --user on Linux) that runs the
 * agent binary; its process output goes beside its log. `PWR_AGENT_SUPERVISED` makes a Studio
 * restart exit non-zero so the service manager, not the agent, starts the new process. Only a
 * pinned port is written into the unit; otherwise the agent may move off a busy default port.
 */
const installService = (port: number | undefined): void => {
  const command = resolveAgentCommand();
  const { outputFile } = agentFilePaths();
  if (process.platform === "darwin") {
    const path = launchAgentPath();
    mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(
      path,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>${command.map((part) => `<string>${xml(part)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key>
  <dict>
${port === undefined ? "" : `    <key>PWR_AGENT_PORT</key><string>${port}</string>\n`}    <key>PWR_AGENT_SUPERVISED</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(outputFile)}</string>
  <key>StandardErrorPath</key><string>${xml(outputFile)}</string>
</dict>
</plist>
`,
      { mode: 0o644 },
    );
    console.log(`Installed ${path}`);
    console.log(`Load it now with: launchctl load -w ${path}`);
    return;
  }
  if (process.platform === "linux") {
    const path = systemdUnitPath();
    mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
    writeFileSync(
      path,
      `[Unit]
Description=PWR webhook relay agent
After=network-online.target

[Service]
ExecStart=${command.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ")}
${port === undefined ? "" : `Environment=PWR_AGENT_PORT=${port}\n`}Environment=PWR_AGENT_SUPERVISED=1
Restart=on-failure
StandardOutput=append:${outputFile}
StandardError=append:${outputFile}

[Install]
WantedBy=default.target
`,
      { mode: 0o644 },
    );
    console.log(`Installed ${path}`);
    console.log("Enable it now with: systemctl --user enable --now pwr-agent");
    return;
  }
  throw new Error("install-service supports macOS (launchd) and Linux (systemd --user) only");
};

const uninstallService = (): void => {
  const path = process.platform === "darwin" ? launchAgentPath() : systemdUnitPath();
  if (!existsSync(path)) {
    console.log("No agent service is installed.");
    return;
  }
  console.log(
    process.platform === "darwin"
      ? `Unload first if loaded: launchctl unload -w ${path}`
      : "Disable first if enabled: systemctl --user disable --now pwr-agent",
  );
  rmSync(path);
  console.log(`Removed ${path}`);
};

/**
 * `pwr agent <start|stop|restart|status|logs|install-service|uninstall-service>`.
 * @param action - Subcommand.
 * @param port - Pinned `--port`; omitted, the running agent's port is discovered.
 */
export const executeAgentCommand = async (action: string | undefined, port?: number) => {
  switch (action) {
    case "start": {
      if ((await checkAgentHealth(port)).online) {
        console.log(colorize(`Agent already running on 127.0.0.1:${agentPort(port)}`, colors.dim));
        return;
      }
      if (!(await startAgentDaemon(port)))
        throw new Error("Agent did not start; see `pwr agent logs`");
      console.log(colorize(`● Agent running on 127.0.0.1:${agentPort(port)}`, colors.brightGreen));
      return;
    }
    case "stop": {
      const outcome = await stopAgentDaemon();
      if (outcome === "timeout") throw new Error("Agent did not exit within 15s");
      console.log(outcome === "stopped" ? "Agent stopped." : "Agent is not running.");
      return;
    }
    case "restart":
      await executeAgentCommand("stop", port);
      await executeAgentCommand("start", port);
      return;
    case "status": {
      const health = await checkAgentHealth(port);
      const pid = agentDaemonPid();
      console.log(
        health.online
          ? `${colorize("● running", colors.brightGreen)} on 127.0.0.1:${agentPort(port)}${pid ? ` (pid ${pid})` : ""}`
          : colorize("○ not running (start it with: pwr agent start)", colors.brightYellow),
      );
      console.log(colorize(`  logs: ${agentFilePaths().logFile}`, colors.dim));
      return;
    }
    case "logs":
      await printLogs(200);
      return;
    case "install-service":
      installService(pinnedAgentPort(port));
      return;
    case "uninstall-service":
      uninstallService();
      return;
    default:
      throw new Error(
        "Usage: pwr agent <start|stop|restart|status|logs|install-service|uninstall-service>",
      );
  }
};

/**
 * `pwr studio`: start the agent if needed and open Studio signed in with the local token.
 * The token travels once in the URL and is exchanged for an HttpOnly session cookie.
 */
export const executeStudioCommand = async (port: number | undefined, openBrowser: boolean) => {
  if (!(await checkAgentHealth(port)).online && !(await startAgentDaemon(port)))
    throw new Error("Agent did not start; see `pwr agent logs`");
  const token = readAgentToken();
  if (!token) throw new Error("Agent token not found; is the agent running as this user?");
  const url = `http://127.0.0.1:${agentPort(port)}/auth?token=${token}`;
  console.log(`Studio: ${colorize(url, colors.brightCyan)}`);
  if (!openBrowser) return;
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    Bun.spawn([opener, url], { stdio: ["ignore", "ignore", "ignore"] }).unref();
  } catch {
    console.log(colorize("Could not open a browser; open the URL above.", colors.dim));
  }
};

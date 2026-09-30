import { parseArgs } from "node:util";

import { PWR_VERSION } from "@pockrew/pwr-shared/libs";
import { AgentUpdateModeSchema } from "@pockrew/pwr-shared/schemas";

import { executeAgentCommand, executeStudioCommand } from "~/commands/agent.cmd";
import { executeConnectCommand } from "~/commands/connect.cmd";
import { executeInspectCommand } from "~/commands/inspect.cmd";
import { executeCliMaintenance } from "~/commands/maintenance.cmd";
import { executeManageCommand } from "~/commands/manage.cmd";
import { executeProxyCommand } from "~/commands/proxy.cmd";
import { executeReplayCommand } from "~/commands/replay.cmd";
import { executeStatusCommand } from "~/commands/status.cmd";
import { executeUpdateCommand } from "~/commands/update.cmd";

/** Reject malformed Agent ports before any health probe or daemon launch. */
const readAgentPort = (value: string | boolean | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("Error: --port must be an integer between 1 and 65535.");
    process.exit(1);
  }
  return port;
};

/** Parse bounded numeric flags without silently accepting suffixes such as `10garbage`. */
const readPositiveIntegerOption = (
  name: string,
  value: string | boolean | undefined,
  max?: number,
): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    console.error(`Error: --${name} must be an integer from 1${max ? ` to ${max}` : ""}.`);
    process.exit(1);
  }
  return parsed;
};

/**
 * Prints CLI usage instructions, available command categories, and command-line options.
 */
const printHelp = (): void => {
  console.log(`
pwr • Local Webhook Relay & Inspector

Usage:
  pwr [command] [options]
  pwr connect <server-slug> [--alias <local-name>]
  pwr replay <delivery-id> [--tunnel <alias>] [--project <id>]

Commands:
  agent <action>      start | stop | restart | status | logs | install-service | uninstall-service
  studio              Open the local Studio inspector, signed in (--no-open prints the URL)
  update              Install the latest release (--check only checks; --mode auto|manual|never)
  tunnel, connect     Open a reverse webhook tunnel via background Agent daemon
  status, ls          Inspect background agent daemon health and active tunnels
  inspect, requests   List or inspect captured webhook requests from local store
  replay <id>         Replay one stored delivery to its local endpoint
  proxy [status|set]  Inspect or update corporate proxy routing settings
  clean               Prune eligible local history under the Agent retention policy
  collections         List, create, get, update, or resolve local collections
  endpoints           List, create, get, update, or resolve local endpoints
  secrets             Manage local endpoint secrets and saved relay keys
  help, --help        Show this help message
  version, --version  Show version information

Options:
  -t, --tunnel <slug>     Server tunnel slug (default: "default")
  --alias <name>          Optional local name for this connection
  -s, --server <url>      Central Server URL (default: localhost:18787)
  -k, --api-key -         Read the outbound relay key from stdin (or set PWR_API_KEY); Agent saves it locally
  --takeover              Replace another agent currently connected to this tunnel
  --project <name>        Project identifier
  --port <number>         Agent daemon HTTP port (default: 18788, or the port a running agent moved to)
  --cursor <id>           Continue an inspect page using its next cursor
  --limit <1-100>         Maximum inspect rows per page
  --secret -              Read an endpoint secret from stdin; saved together with --target

Management examples:
  pwr collections list my-alias [--cursor <id>]
  pwr collections create my-alias payments
  pwr collections get my-alias <collection-id>
  pwr collections update my-alias <collection-id> --active false
  pwr collections resolve my-alias <collection-id> --choice local|server
  pwr endpoints list my-alias [--cursor <id>]
  pwr endpoints create my-alias <collection-id> --path /hooks --target http://127.0.0.1:3000/hooks
  pwr endpoints get my-alias <collection-id> <endpoint-id>
  pwr endpoints update my-alias <collection-id> <endpoint-id> --target http://127.0.0.1:4000/hooks
  printf '%s' "$SECRET" | pwr endpoints update my-alias <collection-id> <endpoint-id> \\
    --target http://127.0.0.1:4000/hooks --secret - [--header x-target-key]
  pwr endpoints resolve my-alias <collection-id> <endpoint-id> --choice local|server
  pwr secrets status my-alias <collection-id> <endpoint-id>
  printf '%s' "$SECRET" | pwr secrets set my-alias <collection-id> <endpoint-id>
  pwr secrets delete my-alias <collection-id> <endpoint-id>
  pwr secrets relay status my-alias
  printf '%s' "$RELAY_KEY" | pwr secrets relay set my-alias
  pwr secrets relay delete my-alias
`);
};

/**
 * Main application CLI dispatcher that parses arguments and executes the requested command controller.
 */
const main = async (): Promise<void> => {
  // 1. Slice process arguments
  const argv = Bun.argv.slice(2);
  const command = argv[0];

  // 2. Global help and version: only as the command itself, so `-v`/`-h` inside another
  // command's arguments never hijack it.
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(`pwr v${PWR_VERSION}`);
    process.exit(0);
  }

  // 2b. Agent lifecycle and Studio sign-in.
  if (command === "agent" || command === "studio") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: { port: { type: "string" }, "no-open": { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    const port = readAgentPort(values.port);
    if (command === "agent") await executeAgentCommand(positionals[0], port);
    else await executeStudioCommand(port, values["no-open"] !== true);
    process.exit(0);
  }

  // 2c. Self-update through the agent (release binary installs only).
  if (command === "update") {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { check: { type: "boolean" }, mode: { type: "string" }, port: { type: "string" } },
      strict: true,
    });
    const mode = AgentUpdateModeSchema.optional().safeParse(values.mode);
    if (!mode.success) {
      console.error("Error: --mode must be auto, manual or never.");
      process.exit(1);
    }
    await executeUpdateCommand({
      port: readAgentPort(values.port),
      checkOnly: values.check === true,
      mode: mode.data,
    });
    process.exit(0);
  }

  // 3. Daemon status and active tunnel inspection
  if (command === "status" || command === "ls") {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { port: { type: "string" } },
      strict: true,
    });
    await executeStatusCommand(readAgentPort(values.port));
    process.exit(0);
  }

  // 4. Inspect captured webhooks
  if (command === "inspect" || command === "requests") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: {
        tunnel: { type: "string", short: "t" },
        project: { type: "string" },
        search: { type: "string", short: "q" },
        limit: { type: "string", short: "l" },
        cursor: { type: "string" },
        port: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });

    const targetId = positionals.find((p) => !p.startsWith("-"));
    if (values.search !== undefined) {
      console.error(
        "Search is not supported by the Agent request API yet; use --tunnel or --project.",
      );
      process.exit(1);
    }
    const rawLimit = readPositiveIntegerOption("limit", values.limit, 100);
    const rawPort = readAgentPort(values.port);

    await executeInspectCommand({
      id: targetId,
      tunnelId: typeof values.tunnel === "string" ? values.tunnel : undefined,
      projectId: typeof values.project === "string" ? values.project : undefined,
      limit: rawLimit,
      cursor: typeof values.cursor === "string" ? values.cursor : undefined,
      port: rawPort,
    });
    process.exit(0);
  }

  // 5. Replay captured webhook
  if (command === "replay") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: {
        to: { type: "string" },
        "forward-to": { type: "string", short: "f" },
        tunnel: { type: "string", short: "t" },
        project: { type: "string" },
        port: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });

    const targetId = positionals.find((p) => !p.startsWith("-"));
    if (!targetId) {
      console.error("Error: Delivery ID is required. Example: pwr replay <delivery-id>");
      process.exit(1);
    }

    if (values.to !== undefined || values["forward-to"] !== undefined) {
      console.error(
        "Replay target override is unsupported; edit the local endpoint target instead.",
      );
      process.exit(1);
    }
    const rawPort = readAgentPort(values.port);

    await executeReplayCommand({
      id: targetId,
      tunnelId: typeof values.tunnel === "string" ? values.tunnel : undefined,
      projectId: typeof values.project === "string" ? values.project : undefined,
      port: rawPort,
    });
    process.exit(0);
  }

  // 6. Corporate proxy configuration
  if (command === "proxy") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: {
        mode: { type: "string" },
        http: { type: "string" },
        https: { type: "string" },
        "no-proxy": { type: "string" },
        "ca-cert": { type: "string" },
        port: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });

    if (positionals[0] && !["set", "status"].includes(positionals[0])) {
      console.error("Usage: pwr proxy [status|set] [--mode auto|manual|disabled] [...]");
      process.exit(1);
    }
    if (
      values.mode !== undefined &&
      !["manual", "disabled", "auto"].includes(String(values.mode))
    ) {
      console.error("Error: --mode must be auto, manual or disabled.");
      process.exit(1);
    }
    const action = positionals[0] === "set" ? "set" : "status";
    const mode =
      values.mode === "manual" || values.mode === "disabled" || values.mode === "auto"
        ? values.mode
        : undefined;
    const rawPort = readAgentPort(values.port);

    await executeProxyCommand({
      action,
      mode,
      httpProxy: typeof values.http === "string" ? values.http : undefined,
      httpsProxy: typeof values.https === "string" ? values.https : undefined,
      noProxy: typeof values["no-proxy"] === "string" ? values["no-proxy"] : undefined,
      caCertPath: typeof values["ca-cert"] === "string" ? values["ca-cert"] : undefined,
      port: rawPort,
    });
    process.exit(0);
  }

  // 7. Database retention maintenance
  if (command === "sync") {
    console.error(
      "The retired sync command is unavailable; Agent configuration sync runs automatically.",
    );
    process.exit(1);
  }
  if (command === "clean" || command === "retention") {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        days: { type: "string", short: "d" },
        projects: { type: "string" },
        all: { type: "boolean", default: false },
        "confirm-token": { type: "string" },
        force: { type: "boolean", default: false },
        port: { type: "string" },
      },
      strict: true,
    });

    const rawDays = readPositiveIntegerOption("days", values.days);
    const rawPort = readAgentPort(values.port);
    const rawProjects =
      typeof values["projects"] === "string"
        ? values["projects"]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : undefined;

    await executeCliMaintenance({
      days: rawDays,
      projects: rawProjects,
      all: Boolean(values.all),
      confirmToken:
        typeof values["confirm-token"] === "string" ? values["confirm-token"] : undefined,
      force: Boolean(values.force),
      port: rawPort,
    });
    process.exit(0);
  }

  // 8. Local configuration commands are thin wrappers around the Agent API.
  if (command === "collections" || command === "endpoints" || command === "secrets") {
    await executeManageCommand(command, argv.slice(1));
    process.exit(0);
  }

  // 9. A removed or misspelled command must never become an implicit tunnel slug.
  const isExplicitTunnel = command === "tunnel" || command === "connect" || command === "listen";
  if (!isExplicitTunnel) throw new Error(`Unknown command: ${command}. Run pwr help.`);
  const parseTargetArgs = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: parseTargetArgs,
    options: {
      tunnel: { type: "string", short: "t" },
      alias: { type: "string" },
      "forward-to": { type: "string", short: "f" },
      to: { type: "string" },
      server: { type: "string", short: "s" },
      "api-key": { type: "string", short: "k" },
      project: { type: "string" },
      port: { type: "string" },
      takeover: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });

  // Secrets never come from argv (shell history, `ps`): only `--api-key -` with stdin, or env.
  const rawApiKey = typeof values["api-key"] === "string" ? values["api-key"] : undefined;
  if (rawApiKey !== undefined && rawApiKey !== "-")
    throw new Error(
      "Pass the relay key on stdin: printf '%s' \"$KEY\" | pwr connect <slug> --api-key -",
    );
  let apiKey = process.env["PWR_API_KEY"];
  if (rawApiKey === "-") {
    if (process.stdin.isTTY) throw new Error("Pipe the relay key on stdin");
    apiKey = (await Bun.stdin.text()).replace(/\r?\n$/, "");
    if (!apiKey) throw new Error("Relay key stdin is empty");
  }
  const rawServer = typeof values.server === "string" ? values.server : undefined;
  const rawProject = typeof values.project === "string" ? values.project : undefined;

  const positionalTunnel = positionals.find((p) => !p.startsWith("-"));
  const rawSlug = values.tunnel ?? positionalTunnel;
  const slug =
    typeof rawSlug === "string" &&
    rawSlug.length > 0 &&
    !["tunnel", "connect", "listen"].includes(rawSlug)
      ? rawSlug
      : "default";
  if (values.to !== undefined || values["forward-to"] !== undefined) {
    console.error(
      "--to belongs to the retired tunnel target flow; configure local endpoints instead.",
    );
    process.exit(1);
  }
  const tunnelId = typeof values.alias === "string" ? values.alias : slug;
  const serverWsUrl = (
    rawServer ??
    process.env["PWR_SERVER_URL"] ??
    "http://localhost:18787"
  ).replace(/^http(s?):/, "ws$1:");

  // 10. Dispatch connection to Agent daemon and stream logs
  await executeConnectCommand({
    tunnelId,
    slug,
    serverWsUrl,
    // An omitted key lets the Agent reuse the relay key already saved in its local DB.
    apiKey,
    projectId: rawProject ?? process.env["PWR_PROJECT"] ?? "default",
    port: readAgentPort(values.port),
    takeover: values.takeover === true,
  });
};

void main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : "Invalid CLI arguments"}`);
  process.exitCode = 1;
});

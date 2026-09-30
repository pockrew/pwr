import { formatMaintenanceResult } from "@pockrew/pwr-core";
import {
  MaintenanceActionInputSchema,
  MaintenanceActionResultSchema,
  type MaintenanceActionInput,
} from "@pockrew/pwr-shared/schemas";

import {
  agentCleanRetention,
  agentPort,
  createAgentRpcClient,
  ensureAgentDaemonRunning,
} from "~/client/daemon.client";
import { colorize, colors } from "~/ui/ansi";

/**
 * CLI command controller that triggers retention cleanup on the local Agent daemon.
 *
 * @param options - Execution flags including days constraint, target project list, or all-projects token.
 */
export const executeCliMaintenance = async (options: {
  days?: number | undefined;
  projects?: string[] | undefined;
  all?: boolean | undefined;
  confirmToken?: string | undefined;
  force?: boolean | undefined;
  port?: number | undefined;
}): Promise<void> => {
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

  const isAll = Boolean(options.all);
  const confirmToken = options.confirmToken ?? (options.force ? "CONFIRM_ALL" : undefined);

  // 2. Validate safety guards (all-projects confirmation and maximum project batch limits)
  if (isAll && confirmToken !== "CONFIRM_ALL") {
    console.error(`
${colorize("⛔ CRITICAL WARNING", colors.brightRed)}
You have selected to CLEAN across ALL projects.
To prevent accidental loss, this operation requires explicit confirmation.
Please re-run with: ${colorize("--all --confirm-token CONFIRM_ALL", colors.bold)} (or ${colorize("--force", colors.bold)}).
`);
    process.exit(1);
  }

  if (!isAll && options.projects && options.projects.length > 3) {
    console.error(`
${colorize("⛔ VALIDATION ERROR", colors.brightRed)}
Bulk operations are restricted to a maximum of 3 projects per request (you provided ${options.projects.length}).
`);
    process.exit(1);
  }

  // 3. Construct and validate maintenance request payload schema
  const payload: MaintenanceActionInput = {
    action: "clean",
    days: options.days ?? 7,
    projects: options.projects && options.projects.length > 0 ? options.projects : undefined,
    all: isAll,
    confirmToken,
  };

  const validation = MaintenanceActionInputSchema.safeParse(payload);
  if (!validation.success) {
    console.error(
      colorize("Validation error:", colors.brightRed),
      validation.error.issues[0]?.message,
    );
    process.exit(1);
  }

  console.log(colorize("⏳ Cleaning local Agent SQLite store...", colors.brightBlue));

  try {
    // 4. Dispatch RPC call to Agent daemon maintenance endpoint
    const result = await agentCleanRetention(client, payload);

    if (!result) {
      console.error(colorize("✕ Retention maintenance failed on Agent daemon.", colors.brightRed));
      process.exit(1);
    }

    // 5. Parse and validate result schema
    const parsedResult = MaintenanceActionResultSchema.strip().safeParse(result);
    if (!parsedResult.success) {
      console.log(colorize("✔ Maintenance finished with output:", colors.brightGreen), result);
      return;
    }

    // 6. Format and render result
    const output = formatMaintenanceResult(parsedResult.data);
    console.log("\n" + output + "\n");
  } catch (err) {
    console.error(
      colorize("✕ Maintenance error:", colors.brightRed),
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
};

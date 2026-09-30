import { z } from "zod";

/**
 * `manual` checks daily and waits for the user, `auto` also installs and restarts, `never` makes
 * no background check (a check still runs when the user asks).
 */
export const AgentUpdateModeSchema = z.enum(["manual", "auto", "never"]);

export const AgentUpdateConfigSchema = z.strictObject({ mode: AgentUpdateModeSchema });

export type AgentUpdateMode = z.infer<typeof AgentUpdateModeSchema>;

/** Self-update state of a release binary install. */
export interface AgentUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checkedAt: string | null;
  lastError: string | null;
  mode: AgentUpdateMode;
  state: "idle" | "checking" | "downloading" | "restarting";
  /** Download of the current release asset (`pwr-agent-<platform>`, then `pwr-<platform>`). */
  progress: { asset: string; receivedBytes: number; totalBytes: number | null } | null;
  /** Null when this install can update itself; otherwise why not (source run, read-only dir…). */
  unsupportedReason: string | null;
  /** One-line installer for the agent's platform; the fallback when it cannot update itself. */
  installCommand: string;
}

import { applyServerLogSettings } from "@server/platform/logging";

import {
  DEFAULT_LOG_SETTINGS,
  LogSettingsSchema,
  type LogSettings,
} from "@pockrew/pwr-shared/schemas";

import { readSetting, writeSetting } from "./repository";

const SETTINGS_KEY = "logs";

/** Saved server log settings; the defaults when none are saved or the row is unreadable. */
export const loadLogSettings = (): LogSettings => {
  const saved = readSetting(SETTINGS_KEY);
  if (!saved) return DEFAULT_LOG_SETTINGS;
  try {
    return LogSettingsSchema.parse(JSON.parse(saved));
  } catch {
    return DEFAULT_LOG_SETTINGS;
  }
};

/**
 * Persist new log settings, then reconfigure logging with them.
 * @returns The settings now in effect.
 */
export const saveLogSettings = async (settings: LogSettings): Promise<LogSettings> => {
  // 1. Saved first: settings that cannot be stored must not leave a reconfigured logger behind.
  writeSetting(SETTINGS_KEY, JSON.stringify(settings));
  // 2. The previous file is flushed and closed before the new rotation limits apply.
  await applyServerLogSettings(settings);
  return settings;
};

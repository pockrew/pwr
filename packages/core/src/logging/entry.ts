import { isRecord } from "@pockrew/pwr-shared/libs";
import type { LogEntry, LogFilter, LogLevel } from "@pockrew/pwr-shared/schemas";

const SEVERITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
  fatal: 5,
};

/** LogTape's JSON Lines level names. */
const LEVELS: Record<string, LogLevel> = {
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warning",
  WARNING: "warning",
  ERROR: "error",
  FATAL: "fatal",
};

/** True when `level` is at least `minimum`. */
export const isAtLeastLevel = (level: LogLevel, minimum: LogLevel): boolean =>
  SEVERITY[level] >= SEVERITY[minimum];

/**
 * Parse one line of a LogTape JSON Lines file. Any other line (older plain-text logs, runtime
 * output) becomes a raw entry with no timestamp.
 * @param id - Cursor of the line (`<inode>:<offset>`).
 */
export const parseLogLine = (id: string, line: string): LogEntry => {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    record = null;
  }
  if (!isRecord(record) || typeof record["@timestamp"] !== "string")
    return { id, timestamp: null, level: "info", category: null, message: line, properties: {} };
  const properties = record["properties"];
  return {
    id,
    timestamp: record["@timestamp"],
    level: LEVELS[String(record["level"])] ?? "info",
    category: typeof record["logger"] === "string" ? record["logger"] : null,
    message: typeof record["message"] === "string" ? record["message"] : "",
    properties: isRecord(properties) ? properties : {},
  };
};

/** True when an entry is at least `level` and contains `q` in its message, category or properties. */
export const matchesLogFilter = (entry: LogEntry, filter: LogFilter): boolean => {
  if (filter.level && !isAtLeastLevel(entry.level, filter.level)) return false;
  const q = filter.q?.toLowerCase();
  if (!q) return true;
  const text = `${entry.category ?? ""} ${entry.message} ${JSON.stringify(entry.properties)}`;
  return text.toLowerCase().includes(q);
};

/** JSON text of a (masked) logged value; values JSON cannot represent fall back to `String`. */
export const stringifyLogValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** One human-readable line: `<time> <LEVEL> [category] message {properties}`. */
export const formatLogEntry = (entry: LogEntry): string => {
  const properties = Object.keys(entry.properties).length
    ? ` ${stringifyLogValue(entry.properties)}`
    : "";
  const category = entry.category ? `[${entry.category}] ` : "";
  return `${entry.timestamp ?? "-"} ${entry.level.toUpperCase()} ${category}${entry.message}${properties}`;
};

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getRotatingFileSink } from "@logtape/file";
import {
  configure,
  dispose,
  getConsoleSink,
  type LogRecord,
  type Sink,
  type TextFormatter,
} from "@logtape/logtape";

import type { LogEntry, LogLevel, LogSettings } from "@pockrew/pwr-shared/schemas";

import { formatLogEntry, stringifyLogValue } from "./entry";
import { redactingSink } from "./redact";

const LEVEL_TAGS: Record<LogLevel, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO",
  warning: "WARN",
  error: "ERROR",
  fatal: "FATAL",
};

/** The record as a log entry; interpolated strings stay unquoted (LogTape's formatters quote them). */
const toEntry = (record: LogRecord): LogEntry => ({
  id: "",
  timestamp: new Date(record.timestamp).toISOString(),
  level: record.level,
  category: record.category.join("."),
  message: record.message
    .map((part, index) =>
      index % 2 === 0 || typeof part === "string" ? String(part) : stringifyLogValue(part),
    )
    .join(""),
  properties: record.properties,
});

/** JSON Lines in LogTape's field layout (`@timestamp`, `level`, `message`, `logger`, `properties`). */
const jsonLine: TextFormatter = (record) => {
  const entry = toEntry(record);
  const line = stringifyLogValue({
    "@timestamp": entry.timestamp,
    level: LEVEL_TAGS[entry.level],
    message: entry.message,
    logger: entry.category,
    properties: entry.properties,
  });
  return `${line}\n`;
};

/** Readable console line, the same text `pwr agent logs` prints. */
const textLine: TextFormatter = (record) => `${formatLogEntry(toEntry(record))}\n`;

/** Where a process logs and how its console copy looks. */
export interface ILoggingTarget {
  /** Root LogTape category of the process, e.g. `["pwr", "agent"]`. */
  category: string[];
  /** JSON Lines file read by the log viewers; rotated to `<file>.1` … `<file>.<maxFiles>`. */
  file: string;
  /** Console copy: readable text, JSON Lines for log collectors, or none. */
  console: "text" | "json" | false;
}

/** One store for the process: reconfiguring must not drop contexts of requests in flight. */
const contextLocalStorage = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * (Re)configure LogTape for a process: a rotating JSON Lines file plus an optional console copy.
 * Every sink receives masked records only (see `redactingSink`).
 * Calling it again (after a settings change) flushes and closes the previous file first.
 * Implicit contexts (`withContext`) attach properties such as `requestId` to every record.
 */
export const configureLogging = async (
  target: ILoggingTarget,
  settings: LogSettings,
): Promise<void> => {
  mkdirSync(dirname(target.file), { recursive: true, mode: 0o700 });
  const sinks: Record<string, Sink> = {
    file: redactingSink(
      getRotatingFileSink(target.file, {
        formatter: jsonLine,
        maxSize: settings.maxSizeMb * 1024 * 1024,
        maxFiles: settings.maxFiles,
        // Buffered writes flushed at least twice a second keep request logging off the event loop.
        nonBlocking: true,
        flushInterval: 500,
      }),
    ),
  };
  if (target.console)
    sinks["console"] = redactingSink(
      getConsoleSink({ formatter: target.console === "json" ? jsonLine : textLine }),
    );
  const sinkNames = Object.keys(sinks);
  await configure({
    reset: true,
    contextLocalStorage,
    sinks,
    loggers: [
      { category: target.category, lowestLevel: settings.level, sinks: sinkNames },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: sinkNames },
    ],
  });
};

/** Flush buffered records and close the log file; call before the process exits. */
export const closeLogging = (): Promise<void> => dispose();

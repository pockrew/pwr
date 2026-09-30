import { z } from "zod";

/** LogTape severities, lowest first. */
export const LogLevelSchema = z.enum(["trace", "debug", "info", "warning", "error", "fatal"]);

/** `<inode>:<byte offset>` of a log line; stays valid when rotation renames the file. */
export const LogCursorSchema = z.string().regex(/^\d+:\d+$/);

/**
 * One log entry (a JSON Lines record written by LogTape). `timestamp` is null and `level` is
 * `info` for raw lines written outside LogTape, such as older plain-text logs.
 */
export const LogEntrySchema = z.object({
  id: LogCursorSchema,
  timestamp: z.string().nullable(),
  level: LogLevelSchema,
  category: z.string().nullable(),
  message: z.string(),
  properties: z.record(z.string(), z.unknown()),
});

/** Filters shared by log pages and the live tail: minimum level and case-insensitive text. */
export const LogFilterSchema = z.object({
  level: LogLevelSchema.optional(),
  q: z.string().trim().max(200).optional(),
});

/** Newest-first page; `before` is the previous page's `nextCursor`, `from`/`to` bound by time. */
export const LogPageQuerySchema = LogFilterSchema.extend({
  before: LogCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

/** Live tail starting after a cursor (a page's `tailCursor` or the last `after` received). */
export const LogStreamQuerySchema = LogFilterSchema.extend({ after: LogCursorSchema });

/** What is written and how the log file rotates: `<file>` → `<file>.1` … `<file>.<maxFiles>`. */
export const LogSettingsSchema = z.strictObject({
  level: LogLevelSchema,
  maxSizeMb: z.number().int().min(1).max(500),
  maxFiles: z.number().int().min(1).max(50),
});

export const DEFAULT_LOG_SETTINGS: LogSettings = { level: "info", maxSizeMb: 10, maxFiles: 5 };

export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type LogFilter = z.infer<typeof LogFilterSchema>;
export type LogPageQuery = z.infer<typeof LogPageQuerySchema>;
export type LogSettings = z.infer<typeof LogSettingsSchema>;

/** One page of a log, newest entry first. */
export interface LogPage {
  entries: LogEntry[];
  /** Pass as `before` for older entries (across rotated files); null at the oldest entry or `from`. */
  nextCursor: string | null;
  /** End of the complete lines in the current file when read; start the live tail here. */
  tailCursor: string;
  logFile: string;
  exists: boolean;
}

/** One live-tail batch: new entries (oldest first) and the cursor to resume after. */
export const LogBatchSchema = z.object({
  entries: z.array(LogEntrySchema),
  after: LogCursorSchema,
});

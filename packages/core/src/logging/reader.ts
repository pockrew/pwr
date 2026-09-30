import { open, stat, type FileHandle } from "node:fs/promises";

import type { LogEntry, LogPage, LogPageQuery } from "@pockrew/pwr-shared/schemas";

import { matchesLogFilter, parseLogLine } from "./entry";

const CHUNK_BYTES = 64 * 1024;
/** Bounds one page's work; the returned cursor continues the scan, so rare matches stay cheap. */
const MAX_PAGE_SCAN_BYTES = 4 * 1024 * 1024;
/** Bounds one live-tail read; the next tick continues from where it stopped. */
const MAX_TAIL_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;
const TIMESTAMP = /^\{"@timestamp":"([^"]+)"/;

interface LogFile {
  path: string;
  ino: number;
  size: number;
}

interface Line {
  offset: number;
  text: string;
}

const cursorOf = (ino: number, offset: number): string => `${ino}:${offset}`;

const parseCursor = (cursor: string): { ino: number; offset: number } => {
  const [ino = "0", offset = "0"] = cursor.split(":");
  return { ino: Number(ino), offset: Number(offset) };
};

/** The log file and its rotated predecessors (`<file>.1`, `<file>.2`, …) that exist, newest first. */
const listLogFiles = async (path: string): Promise<LogFile[]> => {
  const files: LogFile[] = [];
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? path : `${path}.${index}`;
    try {
      const info = await stat(candidate);
      files.push({ path: candidate, ino: info.ino, size: info.size });
    } catch {
      if (index > 0) return files;
    }
  }
};

const readAt = async (file: FileHandle, position: number, length: number): Promise<Buffer> => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
};

const withFile = async <T>(path: string, use: (file: FileHandle) => Promise<T>): Promise<T> => {
  const file = await open(path, "r");
  try {
    return await use(file);
  } finally {
    await file.close();
  }
};

/** End of the last complete line, so a write in progress is never shown half-done. */
const completeEnd = async (file: FileHandle, size: number): Promise<number> => {
  const start = Math.max(0, size - CHUNK_BYTES);
  const tail = await readAt(file, start, size - start);
  if (!tail.length || tail.at(-1) === NEWLINE) return size;
  const newline = tail.lastIndexOf(NEWLINE);
  return newline === -1 ? size : start + newline + 1;
};

/** Visit lines ending at or before `end`, newest first, until `visit` returns false. */
const scanBackward = async (
  file: FileHandle,
  end: number,
  visit: (line: Line) => boolean,
): Promise<boolean> => {
  let position = end;
  let rest = Buffer.alloc(0);
  while (position > 0) {
    const length = Math.min(CHUNK_BYTES, position);
    position -= length;
    const buffer = Buffer.concat([await readAt(file, position, length), rest]);
    let lineEnd = buffer.length;
    let newline = buffer.lastIndexOf(NEWLINE, lineEnd - 1);
    while (newline !== -1) {
      const text = buffer.subarray(newline + 1, lineEnd).toString("utf8");
      if (text && !visit({ offset: position + newline + 1, text })) return false;
      lineEnd = newline;
      newline = lineEnd > 0 ? buffer.lastIndexOf(NEWLINE, lineEnd - 1) : -1;
    }
    rest = buffer.subarray(0, lineEnd);
  }
  return rest.length ? visit({ offset: 0, text: rest.toString("utf8") }) : true;
};

/** First timestamped line starting at or after `position`, searched within 256 KB. */
const headAtOrAfter = async (
  file: FileHandle,
  position: number,
  size: number,
): Promise<{ offset: number; time: number } | null> => {
  // Include the byte before `position` so a line starting exactly there is found.
  const start = Math.max(0, position - 1);
  const buffer = await readAt(file, start, Math.min(4 * CHUNK_BYTES, size - start));
  let lineStart = position === 0 ? 0 : buffer.indexOf(NEWLINE) + 1;
  if (position > 0 && lineStart === 0) return null;
  while (lineStart < buffer.length) {
    const newline = buffer.indexOf(NEWLINE, lineStart);
    if (newline === -1) return null;
    const match = TIMESTAMP.exec(buffer.subarray(lineStart, newline).toString("utf8"));
    if (match?.[1]) return { offset: start + lineStart, time: Date.parse(match[1]) };
    lineStart = newline + 1;
  }
  return null;
};

/** Offset of the first entry newer than `to` in one file, by binary search over byte positions. */
const offsetAfter = async (file: FileHandle, size: number, to: number): Promise<number> => {
  let low = 0;
  let high = size;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const head = await headAtOrAfter(file, middle, size);
    if (!head || head.time > to) high = middle;
    else low = head.offset + 1;
  }
  return (await headAtOrAfter(file, low, size))?.offset ?? size;
};

/** Newest file that starts at or before `to`, and where in it the entries after `to` begin. */
const locateTime = async (
  files: LogFile[],
  to: number,
): Promise<{ index: number; end: number } | null> => {
  for (const [index, file] of files.entries()) {
    const found = await withFile(file.path, async (handle) => {
      const first = await headAtOrAfter(handle, 0, file.size);
      return first && first.time <= to ? offsetAfter(handle, file.size, to) : null;
    });
    if (found !== null) return { index, end: found };
  }
  return null;
};

/**
 * Read one newest-first page, continuing across rotated files.
 * 1. The first page starts at the end of the current file, or right after `to`.
 * 2. Lines are scanned backwards, file by file, and filtered.
 * 3. The scan stops at `limit` matches, an entry older than `from`, or 4 MB scanned; the cursor
 *    (inode and offset, valid after later rotations) continues it.
 */
export const readLogPage = async (path: string, query: LogPageQuery): Promise<LogPage> => {
  const files = await listLogFiles(path);
  const current = files[0];
  if (!current)
    return { entries: [], nextCursor: null, tailCursor: "0:0", logFile: path, exists: false };
  const currentEnd = await withFile(current.path, (file) => completeEnd(file, current.size));
  const page = { tailCursor: cursorOf(current.ino, currentEnd), logFile: path, exists: true };

  // 1. Starting point.
  let start: { index: number; end: number } | null = { index: 0, end: currentEnd };
  if (query.before) {
    const cursor = parseCursor(query.before);
    const index = files.findIndex((file) => file.ino === cursor.ino);
    start = index === -1 ? null : { index, end: cursor.offset };
  } else if (query.to) start = await locateTime(files, Date.parse(query.to));

  // 2-3. Scan and bound.
  const from = query.from ? Date.parse(query.from) : null;
  const entries: LogEntry[] = [];
  let nextCursor: string | null = null;
  let scanned = 0;
  for (let index = start?.index ?? files.length; index < files.length; index += 1) {
    const file = files[index];
    if (!file) break;
    const end = index === start?.index ? start.end : file.size;
    const isOldest = index === files.length - 1;
    const finished = await withFile(file.path, (handle) =>
      scanBackward(handle, end, (line) => {
        const entry = parseLogLine(cursorOf(file.ino, line.offset), line.text);
        if (from !== null && entry.timestamp && Date.parse(entry.timestamp) < from) return false;
        if (matchesLogFilter(entry, query)) entries.push(entry);
        scanned += line.text.length + 1;
        if (entries.length < query.limit && scanned < MAX_PAGE_SCAN_BYTES) return true;
        if (line.offset > 0 || !isOldest) nextCursor = cursorOf(file.ino, line.offset);
        return false;
      }),
    );
    if (!finished) break;
  }
  return { entries, nextCursor, ...page };
};

/** Complete lines of one file from `offset`, oldest first, and the offset after them. */
const readForward = async (
  file: LogFile,
  offset: number,
): Promise<{ entries: LogEntry[]; offset: number }> => {
  if (file.size <= offset) return { entries: [], offset };
  const buffer = await withFile(file.path, (handle) =>
    readAt(handle, offset, Math.min(file.size - offset, MAX_TAIL_BYTES)),
  );
  // Stop at the last complete line; a single line longer than the read window is taken whole.
  const lastNewline = buffer.lastIndexOf(NEWLINE);
  const consumed =
    lastNewline === -1 ? (buffer.length === MAX_TAIL_BYTES ? buffer.length : 0) : lastNewline + 1;
  const entries: LogEntry[] = [];
  let lineOffset = offset;
  for (const text of buffer.subarray(0, consumed).toString("utf8").split("\n")) {
    if (text) entries.push(parseLogLine(cursorOf(file.ino, lineOffset), text));
    lineOffset += Buffer.byteLength(text) + 1;
  }
  return { entries, offset: offset + consumed };
};

/**
 * Read entries written after cursor `after`, oldest first. After a rotation it finishes the
 * renamed file, then continues at the start of the next newer one. `reset` means the file shrank in
 * place, so the client must reload instead of resuming.
 */
export const readLogTail = async (
  path: string,
  after: string,
): Promise<{ entries: LogEntry[]; next: string; reset: boolean }> => {
  const cursor = parseCursor(after);
  const files = await listLogFiles(path);
  const current = files[0];
  if (!current) return { entries: [], next: after, reset: false };
  const followed = files.find((file) => file.ino === cursor.ino);
  if (followed && followed.size < cursor.offset) return { entries: [], next: after, reset: true };
  // The followed file was rotated away and deleted: continue with what exists now.
  if (!followed) return { entries: [], next: cursorOf(current.ino, 0), reset: false };
  const read = await readForward(followed, cursor.offset);
  // A finished rotated file hands over to the start of the next newer one.
  const newer = files[files.indexOf(followed) - 1];
  const next =
    !newer || read.offset < followed.size
      ? cursorOf(followed.ino, read.offset)
      : cursorOf(newer.ino, 0);
  return { entries: read.entries, next, reset: false };
};

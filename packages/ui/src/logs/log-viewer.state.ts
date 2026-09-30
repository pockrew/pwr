import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";

import type {
  LogEntry,
  LogFilter,
  LogLevel,
  LogPage,
  LogPageQuery,
} from "@pockrew/pwr-shared/schemas";

import type { LogRange } from "./log-toolbar";

const PAGE_SIZE = 200;
const RECONNECT_MS = 2_000;
/** Live entries kept before the view reloads from the newest page, bounding memory. */
const LIVE_CAP = 5_000;
const RANGE_MS: Record<Exclude<LogRange, "all" | "custom">, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};

/** Callbacks of a live tail connection opened by the app (it owns the transport and URL). */
export interface LogStreamHandlers {
  onOpen: () => void;
  /** New entries, oldest first, and the cursor to resume after. */
  onBatch: (batch: { entries: LogEntry[]; after: string }) => void;
  /** The log shrank in place; cursors are stale and the view reloads. */
  onReset: () => void;
  onError: () => void;
}

/** Data access supplied by the app: one page of the log, and a live tail from a cursor. */
export interface LogSource {
  fetchPage: (query: LogPageQuery) => Promise<LogPage>;
  /** @returns Function that closes the connection. */
  openStream: (after: string, filter: LogFilter, handlers: LogStreamHandlers) => () => void;
}

const toIso = (local: string): string | undefined =>
  local ? new Date(local).toISOString() : undefined;

/**
 * State of a log viewer: filters, newest-first pages continued by cursor, and a live tail that
 * reconnects from the last cursor received (no lost or repeated entries). Entries arriving while
 * the user is scrolled away are held until they return to the top.
 */
export const createLogViewerState = (source: LogSource) => {
  const [level, setLevel] = createSignal<LogLevel>();
  const [search, setSearch] = createSignal("");
  const [q, setQ] = createSignal("");
  const [range, setRange] = createSignal<LogRange>("all");
  const [custom, setCustom] = createSignal({ from: "", to: "" });
  const [timeWindow, setTimeWindow] = createSignal<{ from?: string; to?: string }>({});
  const [page, setPage] = createSignal<Omit<LogPage, "entries">>();
  const [older, setOlder] = createSignal<LogEntry[]>([]);
  const [live, setLive] = createSignal<LogEntry[]>([]);
  const [held, setHeld] = createSignal<LogEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [following, setFollowing] = createSignal(true);
  const [connected, setConnected] = createSignal(false);
  const [atTop, setAtTop] = createSignal(true);
  let generation = 0;
  let resumeAfter: string | undefined;

  const filter = createMemo<LogFilter>(() => ({ level: level(), q: q() || undefined }));
  const query = createMemo(() => ({ ...filter(), ...timeWindow(), limit: PAGE_SIZE }));
  const canFollow = () => !timeWindow().to;
  const entries = createMemo(() => [...live(), ...older()]);

  // 1. First page for the current filters; a newer request makes older answers stale.
  const loadNewest = async () => {
    const request = ++generation;
    resumeAfter = undefined;
    setLive([]);
    setHeld([]);
    setError(undefined);
    setLoading(true);
    try {
      const { entries: first, ...rest } = await source.fetchPage(untrack(query));
      if (request !== generation) return;
      setOlder(first);
      setPage(rest);
    } catch (cause) {
      if (request === generation) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === generation) setLoading(false);
    }
  };

  // 2. Older entries continue from the last page's cursor, across rotated files.
  const loadOlder = async () => {
    const before = page()?.nextCursor;
    if (!before || loadingMore()) return;
    const request = generation;
    setLoadingMore(true);
    try {
      const { entries: next, ...rest } = await source.fetchPage({ ...untrack(query), before });
      if (request !== generation) return;
      setOlder((current) => [...current, ...next]);
      setPage(rest);
    } catch (cause) {
      if (request === generation) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingMore(false);
    }
  };

  const showHeld = () => {
    setLive((current) => [...held(), ...current]);
    setHeld([]);
  };

  // Debounced server-side text search.
  createEffect(() => {
    const value = search().trim();
    const timer = setTimeout(() => setQ(value), 300);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(on(query, () => void loadNewest()));
  createEffect(() => {
    if (atTop() && held().length) untrack(showHeld);
  });

  // 3. Live tail from the first page's end while the range is open-ended.
  createEffect(() => {
    const start = page()?.tailCursor;
    if (!following() || !canFollow() || !start) return;
    const current = filter();
    let after = untrack(() => resumeAfter) ?? start;
    let close = () => {};
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      close = source.openStream(after, current, {
        onOpen: () => setConnected(true),
        onBatch: (batch) => {
          after = batch.after;
          resumeAfter = after;
          if (!batch.entries.length) return;
          const newestFirst = batch.entries.toReversed();
          if (untrack(atTop)) setLive((shown) => [...newestFirst, ...shown]);
          else setHeld((waiting) => [...newestFirst, ...waiting]);
          if (untrack(live).length + untrack(held).length > LIVE_CAP) void loadNewest();
        },
        onReset: () => void loadNewest(),
        onError: () => {
          setConnected(false);
          close();
          retry = setTimeout(connect, RECONNECT_MS);
        },
      });
    };
    connect();
    onCleanup(() => {
      clearTimeout(retry);
      close();
      setConnected(false);
    });
  });

  return {
    level,
    setLevel,
    search,
    setSearch,
    range,
    custom,
    following,
    setFollowing,
    connected,
    canFollow,
    setAtTop,
    entries,
    held,
    showHeld,
    page,
    loading,
    loadingMore,
    error,
    loadNewest,
    loadOlder,
    changeRange: (next: LogRange) => {
      setRange(next);
      if (next === "custom")
        return setTimeWindow({ from: toIso(custom().from), to: toIso(custom().to) });
      setTimeWindow(
        next === "all" ? {} : { from: new Date(Date.now() - RANGE_MS[next]).toISOString() },
      );
    },
    changeCustom: (from: string, to: string) => {
      setCustom({ from, to });
      setTimeWindow({ from: toIso(from), to: toIso(to) });
    },
  };
};

import { startConfigSync } from "@agent/modules/config/sync";
import { agentStreamBroker } from "@agent/modules/relays/broker";
import { relayApiKey } from "@agent/modules/relays/credentials.repository";
import * as repo from "@agent/modules/relays/repository";
import type { ITunnelEntry, ITunnelSession } from "@agent/modules/relays/types";
import {
  isStorageBlocked,
  noteStorageWriteFailure,
} from "@agent/modules/storage/retention.service";
import { getLogger } from "@logtape/logtape";

import { calculateBackoffDelay, type IDrainConfig, type IDrainResult } from "@pockrew/pwr-core";
import {
  AgentRelayConnectSchema,
  RELAY_CLOSE_TUNNEL_IN_USE,
  RelayServerMessageSchema,
  type AgentRelayConnect,
  type RelayClientAck,
  type RelayExecutionResult,
  type RelayScope,
} from "@pockrew/pwr-shared/schemas";

import { openRelaySocket, relayServerUrl } from "./client";
import { PackageExecutor } from "./execution";
import { flushRelayReports, sendRelayReport } from "./reports";

const logger = getLogger(["pwr", "agent", "relay"]);

export type { ITunnelEntry, ITunnelSession };

const toDisconnectedSession = (
  row: NonNullable<ReturnType<typeof repo.savedRelaySession>>,
): ITunnelSession => ({
  tunnelId: row.tunnelId,
  slug: row.slug,
  serverWsUrl: row.serverUrl,
  projectId: row.projectId,
  isPaused: row.isPaused,
  status: "disconnected",
});
const emptyDrain = (tunnelId: string): IDrainResult => ({
  tunnelId,
  totalAttempted: 0,
  succeededCount: 0,
  failedCount: 0,
  durationMs: 0,
});

/** Manages durable relay receipts, local execution and independent result ACKs. */
export class AgentTunnelManager {
  private readonly activeTunnels = new Map<string, ITunnelEntry>();
  private readonly drains = new Map<string, Promise<IDrainResult>>();
  private readonly executor = new PackageExecutor((scope, ack) => this.sendAck(scope, ack));
  private readonly configJobs = new Set<Promise<void>>();

  /** Returns public session snapshots without relay credentials. */
  public getTunnels = (): ITunnelSession[] =>
    repo
      .savedRelaySessions(false)
      .map((row) => this.getTunnel(row.tunnelId) ?? toDisconnectedSession(row));

  /** Returns a local session snapshot by its caller-facing ID, or null. */
  public getTunnel = (tunnelId: string): ITunnelSession | null => {
    const entry = this.activeTunnels.get(tunnelId);
    if (entry) return { ...entry.session };
    const row = repo.savedRelaySession(tunnelId);
    return row ? toDisconnectedSession(row) : null;
  };

  /** Resolves the persisted credential/queue scope of a local session. */
  private scopeOf = (session: ITunnelSession): RelayScope => ({
    serverUrl: session.serverWsUrl,
    slug: session.slug ?? session.tunnelId,
  });

  /** Finds the current connection for a saved package, including after session replacement. */
  private entryFor = (scope: RelayScope): ITunnelEntry | undefined =>
    Array.from(this.activeTunnels.values()).find(
      ({ session }) =>
        session.serverWsUrl === scope.serverUrl &&
        (session.slug ?? session.tunnelId) === scope.slug,
    );

  /**
   * Registers a connection and persists its outbound key before opening WebSocket RPC.
   * @param options - Existing local connection options; slug defaults to tunnelId until CLI/Studio adds it.
   * @param isPaused - Pause state to start with; by default a paused tunnel stays paused, so
   *   re-saving or reconnecting never releases held work (only resume does).
   * @throws On an invalid contract or local credential write failure.
   */
  public connect = (options: AgentRelayConnect, isPaused?: boolean): void => {
    // 1. Reject retired target/fanout config before storing credentials or starting work.
    const input = AgentRelayConnectSchema.parse(options);
    const scope = {
      serverUrl: relayServerUrl(input.serverWsUrl),
      slug: input.slug ?? input.tunnelId,
    };
    relayApiKey(scope, input.apiKey);
    // 2. Replace any local alias of this same server/tunnel, cancelling its reconnect timer.
    const previous = this.entryFor(scope);
    const paused =
      isPaused ??
      previous?.session.isPaused ??
      repo.savedRelaySession(options.tunnelId)?.isPaused ??
      false;
    repo.saveRelaySession({
      ...scope,
      tunnelId: options.tunnelId,
      projectId: input.projectId ?? "default",
      isPaused: paused,
      enabled: true,
    });
    if (previous) this.detach(previous.session.tunnelId);
    this.detach(options.tunnelId);
    const session: ITunnelSession = {
      tunnelId: options.tunnelId,
      slug: scope.slug,
      serverWsUrl: scope.serverUrl,
      projectId: input.projectId ?? "default",
      status: "reconnecting",
      isPaused: paused,
    };
    // 3. Each relay package owns one target; the local queue never invokes the legacy fanout engine.
    const entry: ITunnelEntry = { session, ws: null, takeover: input.takeover };
    this.activeTunnels.set(session.tunnelId, entry);
    this.startSocket(entry);
  };

  /** Disconnects one local session; received packages and result ACKs remain in SQLite. */
  public disconnect = (tunnelId: string): void => {
    repo.updateRelaySession(tunnelId, { enabled: false });
    this.detach(tunnelId);
  };

  /** Stop one socket without erasing durable connection intent during replacement/shutdown. */
  private detach = (tunnelId: string): void => {
    const entry = this.activeTunnels.get(tunnelId);
    if (!entry) return;
    // 1. Remove identity first so delayed socket callbacks cannot resurrect this session.
    this.activeTunnels.delete(tunnelId);
    entry.configSync?.stop();
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    // 2. An in-flight local request may finish and persist its result for a later connection.
    if (entry.ws) {
      entry.ws.onclose = null;
      entry.ws.close();
    }
  };

  /**
   * Restore enabled connections from local SQLite after process startup.
   * @returns Number of restored sessions. Database failures abort startup instead of losing work.
   */
  public restoreConnections = (): number => {
    const sessions = repo.savedRelaySessions();
    let restored = 0;
    for (const session of sessions) {
      // One session that no longer passes validation must not stop the others from resuming.
      try {
        this.connect(
          {
            tunnelId: session.tunnelId,
            slug: session.slug,
            serverWsUrl: session.serverUrl,
            projectId: session.projectId,
          },
          session.isPaused,
        );
        restored += 1;
      } catch {
        logger.error("Saved session {tunnelId} could not be restored", {
          tunnelId: session.tunnelId,
        });
      }
    }
    return restored;
  };

  /**
   * Stop sockets and await in-flight target/result commits before the database closes.
   * @returns Completion of current executions; enabled sessions resume on the next startup.
   */
  public shutdown = async (): Promise<void> => {
    // 1. Prevent further socket callbacks or drains from starting work.
    for (const id of this.activeTunnels.keys()) this.detach(id);
    // 2. A request already observed by a target must have a chance to commit its result.
    await Promise.allSettled([
      ...this.drains.values(),
      ...this.executor.inFlight(),
      ...this.configJobs,
    ]);
  };

  /** Schedules bounded reconnect backoff while this entry still owns the local session. */
  private reconnect = (
    entry: ITunnelEntry,
    reason: NonNullable<ITunnelSession["lastError"]>,
  ): void => {
    if (this.activeTunnels.get(entry.session.tunnelId) !== entry) return;
    entry.session.status = "reconnecting";
    entry.session.lastError = reason;
    entry.retryAttempt = (entry.retryAttempt ?? 0) + 1;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = setTimeout(
      () => this.startSocket(entry),
      calculateBackoffDelay(entry.retryAttempt),
    );
  };

  /**
   * Opens the typed server RPC and validates every frame before acknowledging local storage.
   * @param entry - Current local session; callbacks from replaced sockets are ignored.
   */
  private startSocket = (entry: ITunnelEntry): void => {
    const { session } = entry;
    if (this.activeTunnels.get(session.tunnelId) !== entry) return;
    const scope = this.scopeOf(session);
    try {
      // 1. Authentication is part of HTTP upgrade; the server subscribes automatically.
      entry.intakePaused = isStorageBlocked();
      const ws = openRelaySocket(scope, !entry.intakePaused, entry.takeover);
      entry.ws = ws;
      entry.serverTunnelId = undefined;
      const isCurrent = () => this.activeTunnels.get(session.tunnelId) === entry && entry.ws === ws;
      ws.onmessage = (evt) => {
        if (!isCurrent()) return;
        try {
          // 2. Parse the complete batch before changing durable receipt state.
          if (typeof evt.data !== "string") throw new Error("Expected JSON relay frame");
          const msg = RelayServerMessageSchema.parse(JSON.parse(evt.data));
          if (msg.type === "subscribed") {
            // Bind the canonical ID before accepting packages; a reused slug must fail closed.
            entry.configSync?.stop();
            entry.configSync = startConfigSync(scope, msg.tunnelId, () => {
              // A resolved remote pause/edit can make a locally stored receipt runnable.
              void this.drainTunnel(session.tunnelId).catch(() => this.failSocket(entry, ws));
            });
            const configJob = entry.configSync.done;
            this.configJobs.add(configJob);
            void configJob.finally(() => this.configJobs.delete(configJob));
            entry.serverTunnelId = msg.tunnelId;
            entry.retryAttempt = 0;
            entry.takeover = false;
            session.status = "connected";
            delete session.lastError;
            session.connectedAt = Date.now();
            // Resume local work even when the server has no pending receipts left to sync.
            void this.flushReports(scope, ws);
            void this.drainTunnel(session.tunnelId).catch(() => this.failSocket(entry, ws));
            return;
          }
          if (msg.type === "result_committed") {
            if (!entry.serverTunnelId) throw new Error("Result before subscription");
            repo.markRelayReported(scope, msg.resultId, msg.source);
            return;
          }
          const packets = msg.type === "sync" ? msg.deliveries : msg.events;
          if (
            !entry.serverTunnelId ||
            packets.some((packet) => packet.tunnelId !== entry.serverTunnelId)
          )
            throw new Error("Relay package tunnel mismatch");
          // 3. Commit then ACK every receipt before awaiting any local target request.
          for (const packet of packets) {
            const event = repo.receiveRelayPackage(scope, packet, session.projectId);
            ws.send(
              JSON.stringify({
                type: "ack_received",
                deliveryId: packet.id,
              } satisfies RelayClientAck),
            );
            const saved = repo.getRelayPackage(scope, packet.id);
            if (saved?.ack && saved.reportedAt === null) this.sendAck(scope, saved.ack);
            if (event) agentStreamBroker.broadcast(event, scope);
          }
          // 4. Deduplicate by delivery ID; independent endpoint packages each execute once locally.
          void this.drainTunnel(session.tunnelId).catch(() => this.failSocket(entry, ws));
        } catch (error) {
          noteStorageWriteFailure(error);
          // Do not swallow a storage failure and falsely claim receipt; reconnect repeats pending.
          this.failSocket(entry, ws);
        }
      };
      ws.onclose = (evt) => {
        if (!isCurrent()) return;
        const wasSubscribed = Boolean(entry.serverTunnelId);
        entry.configSync?.stop();
        entry.ws = null;
        if (evt.code === RELAY_CLOSE_TUNNEL_IN_USE) {
          this.yieldTunnel(entry);
          return;
        }
        this.reconnect(entry, wasSubscribed ? "connection_lost" : "relay_handshake_failed");
      };
      ws.onerror = () => {
        // Bun also emits close, which owns reconnection; expose a safe category meanwhile.
        if (isCurrent() && !entry.serverTunnelId) session.lastError = "relay_handshake_failed";
      };
    } catch {
      this.reconnect(entry, "local_socket_failed");
    }
  };

  /**
   * Another agent owns (or just took over) the tunnel: stop reconnecting, also across restarts,
   * until an explicit connect or takeover. Retrying would steal the tunnel back on the owner's
   * next network blip. Already received packages still run and report later.
   */
  private yieldTunnel = (entry: ITunnelEntry): void => {
    entry.session.status = "disconnected";
    entry.session.lastError = "tunnel_in_use";
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    try {
      repo.updateRelaySession(entry.session.tunnelId, { enabled: false });
    } catch {
      logger.error("Could not save that {tunnelId} is owned by another agent", {
        tunnelId: entry.session.tunnelId,
      });
    }
  };

  /** Closes only the failing current socket; logs contain neither frames nor credentials. */
  private failSocket = (entry: ITunnelEntry, ws: WebSocket): void => {
    if (this.activeTunnels.get(entry.session.tunnelId) !== entry || entry.ws !== ws) return;
    logger.error("Processing failed for {tunnelId}; stored work retained", {
      tunnelId: entry.session.tunnelId,
    });
    let blocked = true;
    try {
      blocked = isStorageBlocked();
    } catch {
      // A failed storage read must not prevent closing the socket without an ACK.
    }
    ws.close(
      blocked ? 1013 : 1011,
      blocked ? "Local storage full; reporting remains available" : "Local relay processing failed",
    );
  };

  /** Sends a completed result when connected; its durable copy is kept regardless of send outcome. */
  private sendAck = (scope: RelayScope, ack: RelayClientAck): void => {
    const entry = this.entryFor(scope);
    if (!entry?.ws || entry.ws.readyState !== WebSocket.OPEN || !entry.serverTunnelId) return;
    try {
      sendRelayReport(entry.ws, ack);
    } catch {
      this.failSocket(entry, entry.ws);
    }
  };

  /** Retry pending reports without reading payloads; replacement/failure leaves them durable. */
  private flushReports = (scope: RelayScope, ws: WebSocket): Promise<void> =>
    flushRelayReports(scope, ws, () => this.entryFor(scope)?.ws === ws).catch(() => {
      const entry = this.entryFor(scope);
      if (entry) this.failSocket(entry, ws);
    });

  /** Apply capacity changes and retry results whose parent report may have arrived later. */
  public refreshIntake = (): void => {
    const blocked = isStorageBlocked();
    for (const entry of this.activeTunnels.values()) {
      const ws = entry.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      if (entry.intakePaused !== blocked) ws.close(1013, "Storage capacity changed; reconnect");
      else if (entry.serverTunnelId) void this.flushReports(this.scopeOf(entry.session), ws);
    }
  };

  /**
   * Creates a new local replay record and reports it with the same UUID to the server.
   * @param webhookId - Source delivery ID, or event ID if exactly one target exists.
   * @param scope - Optional resolved local session scope, checked before creating a replay.
   * @param projectId - Optional local project filter, shared by HTTP and MCP entry points.
   * @returns Independent local replay result, also available after reconnect.
   * @throws On an ambiguous source, missing data or database failure.
   */
  public replayLocal = async (
    webhookId: string,
    scope?: RelayScope,
    projectId?: string,
  ): Promise<RelayExecutionResult> => {
    // 1. Resolve a stored delivery; target, headers and bytes belong to its immutable source.
    const source = repo.findReplaySource(webhookId, scope, projectId);
    // 2. Persist a fresh UUID before executing; retries of its ACK keep this same UUID.
    try {
      const replayId = repo.createLocalReplay(source.scope, source.id);
      return this.executor.execute(source.scope, replayId);
    } catch (error) {
      noteStorageWriteFailure(error);
      throw error;
    }
  };

  /**
   * Pause execution while receipts still commit and ACK, allowing server sync to finish.
   * @param tunnelId - Caller-facing local session ID.
   * @returns Whether the session exists; database failures leave its pause state unchanged.
   */
  public pauseTunnel = (tunnelId: string): boolean => {
    const entry = this.activeTunnels.get(tunnelId);
    if (!this.getTunnel(tunnelId)) return false;
    repo.updateRelaySession(tunnelId, { isPaused: true });
    if (entry) entry.session.isPaused = true;
    return true;
  };

  /**
   * Persist resume intent and drain local pending packages without a separate upstream frame.
   * @param tunnelId - Caller-facing local session ID.
   * @param options - Optional local count/delay/rate controls.
   * @returns Drain counts, or null if absent; database/execution errors propagate.
   */
  public resumeTunnel = async (
    tunnelId: string,
    options?: IDrainConfig,
  ): Promise<IDrainResult | null> => {
    const entry = this.activeTunnels.get(tunnelId);
    if (!this.getTunnel(tunnelId)) return null;
    repo.updateRelaySession(tunnelId, { isPaused: false });
    if (entry) entry.session.isPaused = false;
    return this.drainTunnel(tunnelId, options);
  };

  /**
   * Drains stored delivery IDs sequentially without holding a payload backlog in memory.
   * @param tunnelId - Caller-facing local session ID.
   * @param options - Existing local rate/delay/count controls.
   * @returns Counts of target attempts; FAILED results are terminal until an explicit replay.
   */
  public drainTunnel = (tunnelId: string, options?: IDrainConfig): Promise<IDrainResult> => {
    const entry = this.activeTunnels.get(tunnelId);
    if (!entry) return Promise.resolve(emptyDrain(tunnelId));
    const scope = this.scopeOf(entry.session);
    const key = JSON.stringify(scope);
    const active = this.drains.get(key);
    if (active) {
      // A sync frame can arrive while an empty drain is settling. Recheck after its
      // finally removes the lock, otherwise that newly committed package waits forever.
      return active.then((result) =>
        repo.nextRelayPackage(scope) &&
        this.entryFor(scope) &&
        !this.entryFor(scope)?.session.isPaused
          ? this.drainTunnel(tunnelId, options)
          : result,
      );
    }
    const drain = (async () => {
      // 1. Only one drain owns this server/tunnel, including when its socket is replaced.
      const start = performance.now();
      let succeededCount = 0;
      let failedCount = 0;
      const delay =
        options?.delayMs ??
        (options?.rateLimitPerSec ? Math.ceil(1000 / options.rateLimitPerSec) : 0);
      while (this.entryFor(scope) && !this.entryFor(scope)?.session.isPaused) {
        if (options?.maxBatchSize && succeededCount + failedCount >= options.maxBatchSize) break;
        // Blocked storage cannot commit results; stop instead of calling targets we can't record.
        if (isStorageBlocked()) break;
        const id = repo.nextRelayPackage(scope);
        if (!id) break;
        // 2. Target failures are recorded independently; never re-send ack_relayed as a retry.
        const result = await this.executor.execute(scope, id);
        if (result.statusCode >= 200 && result.statusCode < 300) succeededCount += 1;
        else failedCount += 1;
        if (delay > 0) await Bun.sleep(delay);
      }
      // 3. Only relay packages own execution here; an empty queue must not run legacy cache flows.
      return {
        tunnelId,
        totalAttempted: succeededCount + failedCount,
        succeededCount,
        failedCount,
        durationMs: Number((performance.now() - start).toFixed(2)),
      };
    })().finally(() => this.drains.delete(key));
    this.drains.set(key, drain);
    return drain;
  };
}

export const tunnelManager = new AgentTunnelManager();

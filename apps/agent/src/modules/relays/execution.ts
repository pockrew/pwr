import { agentStreamBroker } from "@agent/modules/relays/broker";
import { getEndpointSecret, getEndpointTarget } from "@agent/modules/relays/credentials.repository";
import * as repo from "@agent/modules/relays/repository";
import { noteStorageWriteFailure } from "@agent/modules/storage/retention.service";

import { forwardRelayPackage } from "@pockrew/pwr-core";
import type { RelayClientAck, RelayExecutionResult, RelayScope } from "@pockrew/pwr-shared/schemas";

/**
 * Executes stored packages at most once per process: concurrent callers share one attempt, and a
 * target outcome whose commit failed (e.g. disk full) is retried as a commit, never as another
 * target call. Lost on restart, which is the documented at-least-once window.
 */
export class PackageExecutor {
  private readonly executions = new Map<string, Promise<RelayExecutionResult>>();
  private readonly uncommitted = new Map<string, Awaited<ReturnType<typeof forwardRelayPackage>>>();

  /** @param sendAck - Delivers a committed result ACK upstream when a socket is available. */
  public constructor(private readonly sendAck: (scope: RelayScope, ack: RelayClientAck) => void) {}

  /** In-flight executions, awaited on shutdown so observed target calls can commit. */
  public inFlight = (): Promise<RelayExecutionResult>[] => [...this.executions.values()];

  /**
   * Execute one stored package, shared by live drain and explicit local replay.
   * @returns Its durable result; throws on missing data, a missing target or failed persistence.
   */
  public execute = (scope: RelayScope, id: string): Promise<RelayExecutionResult> => {
    const key = JSON.stringify([scope.serverUrl, id]);
    const active = this.executions.get(key);
    if (active) return active;
    const execution = (async () => {
      // 1. Re-read from SQLite; never rely on an in-memory frame surviving reconnect/restart.
      const stored = repo.getRelayPackage(scope, id);
      if (!stored) throw new Error("Stored relay package is unavailable");
      if (stored.result) return stored.result;
      // 2. Call the agent-owned target once, reusing an uncommitted outcome if it already did.
      let executed = this.uncommitted.get(key);
      if (!executed) {
        const target = getEndpointTarget(scope, stored.packet.endpointId);
        if (target === null) throw new Error("Endpoint has no local target");
        executed = await forwardRelayPackage(
          stored.packet,
          target,
          stored.projectId,
          getEndpointSecret(scope, stored.packet.endpointId),
        );
      }
      const { result, ack } = executed;
      // 3. Commit audit and result ACK before sending anything upstream.
      try {
        repo.completeRelayPackage(scope, id, result, ack);
        this.uncommitted.delete(key);
      } catch (error) {
        this.uncommitted.set(key, executed);
        noteStorageWriteFailure(error);
        throw error;
      }
      // 4. Local viewers see the committed result, never secret headers or payload bytes.
      agentStreamBroker.broadcastDelivery(
        {
          type: "delivery_result",
          eventId: stored.packet.eventId,
          deliveryId: id,
          trigger: stored.packet.trigger,
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
        },
        scope,
      );
      this.sendAck(scope, ack);
      return result;
    })().finally(() => this.executions.delete(key));
    this.executions.set(key, execution);
    return execution;
  };
}

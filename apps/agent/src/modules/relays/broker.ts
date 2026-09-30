// @agent-only
import type { AgentDeliveryStream, RelayScope, WebhookEvent } from "@pockrew/pwr-shared/schemas";

/** Scope stream channels by server and slug; public events retain their canonical tunnel ID. */
export const relayStreamKey = (scope: RelayScope): string =>
  JSON.stringify([scope.serverUrl, scope.slug]);

type AgentEventListener = (event: WebhookEvent) => void;

/**
 * In-memory event broker on the Agent daemon distributing live webhook events
 * to local clients (e.g. Studio UI running on the same developer machine).
 */
class AgentStreamBroker {
  private readonly listeners = new Map<string, Set<AgentEventListener>>();
  private readonly deliveryListeners = new Map<string, Set<(event: AgentDeliveryStream) => void>>();

  /**
   * Subscribes a listener callback to live webhook events for a specific tunnel.
   *
   * @param tunnelId - Target tunnel identifier.
   * @param listener - Callback invoked with WebhookEvent when arriving.
   * @returns Teardown function to unsubscribe.
   */
  public subscribe = (tunnelId: string, listener: AgentEventListener): (() => void) => {
    let set = this.listeners.get(tunnelId);
    if (!set) {
      set = new Set<AgentEventListener>();
      this.listeners.set(tunnelId, set);
    }

    set.add(listener);

    return () => {
      const current = this.listeners.get(tunnelId);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this.listeners.delete(tunnelId);
        }
      }
    };
  };

  /**
   * Broadcasts an incoming webhook event to active local subscribers of that tunnel.
   *
   * @param event - The WebhookEvent payload to deliver locally.
   */
  public broadcast = (event: WebhookEvent, scope?: RelayScope): void => {
    const set = this.listeners.get(scope ? relayStreamKey(scope) : event.tunnelId);
    if (!set || set.size === 0) return;

    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Suppress dead listener errors
      }
    }
  };

  /** Subscribe to committed target results on the same server/slug channel as receipt events. */
  public subscribeDelivery = (
    channel: string,
    listener: (event: AgentDeliveryStream) => void,
  ): (() => void) => {
    const listeners = this.deliveryListeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.deliveryListeners.set(channel, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.deliveryListeners.delete(channel);
    };
  };

  /** Broadcast only safe result metadata after local persistence commits. */
  public broadcastDelivery = (event: AgentDeliveryStream, scope: RelayScope): void => {
    for (const listener of this.deliveryListeners.get(relayStreamKey(scope)) ?? []) {
      try {
        listener(event);
      } catch {
        // Dead local viewers never affect the durable delivery result.
      }
    }
  };

  /**
   * Returns the count of active local subscribers for a tunnel.
   */
  public getSubscriberCount = (tunnelId: string): number => {
    const set = this.listeners.get(tunnelId);
    return set ? set.size : 0;
  };

  /**
   * Clears all registered subscribers.
   */
  public clear = (): void => {
    this.listeners.clear();
    this.deliveryListeners.clear();
  };
}

export const agentStreamBroker = new AgentStreamBroker();

import { createEffect, createRoot, createSignal, onCleanup, untrack } from "solid-js";

import {
  AgentDeliveryStreamSchema,
  WebhookEventSchema,
  type WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

import { fetchRequestDetail, fetchRequests } from "~/libs/api-client";
import { withDecodedBody } from "~/libs/event-body";
import { queryClient } from "~/libs/query-client";
import { tunnelStore } from "~/stores/tunnel.store";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export const wsStore = createRoot(() => {
  const [status, setStatus] = createSignal<ConnectionStatus>("connecting");
  const [events, setEvents] = createSignal<readonly WebhookEvent[]>([]);
  const [isInitialLoading, setIsInitialLoading] = createSignal(true);
  const [isReconnecting, setIsReconnecting] = createSignal(false);
  const [unreadCount, setUnreadCount] = createSignal(0);
  const [hasNewEvent, setHasNewEvent] = createSignal(false);
  const [reconnectTrigger, setReconnectTrigger] = createSignal(0);
  // Why the last load failed (e.g. not signed in, agent offline); null when it succeeded.
  const [loadError, setLoadError] = createSignal<string | null>(null);

  const requestsPerMinute = () => {
    const evs = events();
    if (!evs.length) return 0;
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    return evs.filter((e) => e.createdAt >= oneMinuteAgo).length;
  };

  const reconnectResolvers: ((success: boolean) => void)[] = [];
  // Events belong to one tunnel; switching tunnels starts from an empty feed.
  let lastTunnel = "";

  createEffect(() => {
    const tunnel = tunnelStore.tunnelId;
    const tunnelsLoading = tunnelStore.isLoading;
    // Track reconnect trigger
    reconnectTrigger();
    let isCleanedUp = false;

    // Minimum display duration for "connecting" state to prevent jarring sub-50ms flickers
    const connectStartTime = Date.now();
    const MIN_CONNECT_TIME = 600;

    if (tunnel !== lastTunnel) {
      lastTunnel = tunnel;
      setEvents([]);
    }
    setStatus("connecting");
    // Untracked: this effect writes `events`, so tracking it would re-run the load forever.
    if (untrack(events).length === 0) {
      setIsInitialLoading(true);
    } else {
      setIsReconnecting(true);
    }

    const setSmoothStatus = (newStatus: ConnectionStatus) => {
      if (isCleanedUp) return;
      const elapsed = Date.now() - connectStartTime;
      const resolvePending = () => {
        if (isCleanedUp) return;
        setStatus(newStatus);
        const success = newStatus === "connected";
        const resolvers = [...reconnectResolvers];
        reconnectResolvers.length = 0;
        for (const res of resolvers) {
          res(success);
        }
      };

      if (elapsed < MIN_CONNECT_TIME) {
        setTimeout(resolvePending, MIN_CONNECT_TIME - elapsed);
      } else {
        resolvePending();
      }
    };

    // Nothing to load until the agent has a tunnel; the list query re-runs this effect.
    if (!tunnel) {
      if (tunnelsLoading) return;
      setLoadError(
        tunnelStore.error
          ? "The agent is unreachable."
          : "The agent has no tunnels yet. Connect one with `pwr connect`.",
      );
      setIsInitialLoading(false);
      setIsReconnecting(false);
      setSmoothStatus("disconnected");
      return;
    }

    // Load initial historical requests from the agent (or refresh in background)
    fetchRequests({ tunnelId: tunnel, limit: 50 })
      .then((res) => {
        if (isCleanedUp) return;
        setLoadError(null);
        setEvents((res?.items ?? []).map(withDecodedBody));
      })
      .catch((error: unknown) => {
        if (isCleanedUp) return;
        setEvents([]);
        setLoadError(error instanceof Error ? error.message : "The agent is unreachable.");
      })
      .finally(() => {
        if (!isCleanedUp) {
          setIsInitialLoading(false);
          setIsReconnecting(false);
        }
      });

    // 1. Open tunnel event source and receive events via /api/events/stream
    const streamUrl = `/api/events/stream/${encodeURIComponent(tunnel)}`;
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(streamUrl);

      // 2. Listen for connection event
      eventSource.addEventListener("connected", () => {
        if (isCleanedUp) return;
        setSmoothStatus("connected");
      });

      // 3. Listen for webhook events
      eventSource.addEventListener("webhook", (evt) => {
        if (isCleanedUp) return;
        try {
          const parsed: unknown = JSON.parse(evt.data);
          const validation = WebhookEventSchema.safeParse(parsed);
          if (validation.success) {
            const newEvent = withDecodedBody(validation.data);
            setEvents((prev) => {
              if (prev.some((e) => e.id === newEvent.id)) return prev;
              return [newEvent, ...prev.slice(0, 199)];
            });
            // Trigger pulse animation
            setHasNewEvent(true);
            setTimeout(() => setHasNewEvent(false), 2000);
            // Increment unread if away from requests page
            if (typeof window !== "undefined" && window.location.pathname !== "/") {
              setUnreadCount((prev) => prev + 1);
            }
          }
        } catch {}
      });

      // 4. A finished delivery changes its event's outcome: re-read that event from the agent.
      eventSource.addEventListener("delivery", (evt) => {
        if (isCleanedUp) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          return;
        }
        const delivery = AgentDeliveryStreamSchema.safeParse(parsed);
        if (!delivery.success) return;
        const { eventId } = delivery.data;
        void queryClient.invalidateQueries({ queryKey: ["agent", "deliveries", eventId] });
        fetchRequestDetail(eventId, { tunnelId: tunnel })
          .then((fresh) => {
            if (isCleanedUp) return;
            const updated = withDecodedBody(fresh);
            setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
          })
          .catch(() => {
            // The list keeps the previous outcome; the next load shows the current one.
          });
      });

      // 5. Listen for errors
      eventSource.onerror = () => {
        if (isCleanedUp) return;
        setSmoothStatus("disconnected");
      };
    } catch {
      setSmoothStatus("disconnected");
    }

    // 6. Cleanup
    onCleanup(() => {
      isCleanedUp = true;
      eventSource?.close();
      // NOTE: Do NOT call setStatus("disconnected") here!
      // Solid executes onCleanup synchronously before running the next effect.
      // Setting "disconnected" here causes an instant flash of red/disconnected state.
    });
  });

  return {
    get status() {
      return status();
    },
    get isConnected() {
      return status() === "connected";
    },
    get isConnecting() {
      return status() === "connecting";
    },
    get isReconnecting() {
      return isReconnecting();
    },
    get isLoading() {
      // Only true on initial cold load before data exists
      return isInitialLoading() && events().length === 0;
    },
    get events() {
      return events();
    },
    get unreadCount() {
      return unreadCount();
    },
    get hasNewEvent() {
      return hasNewEvent();
    },
    get requestsPerMinute() {
      return requestsPerMinute();
    },
    get loadError() {
      return loadError();
    },
    markEventsAsRead: () => setUnreadCount(0),
    reconnect: (): Promise<boolean> => {
      if (status() === "connecting") {
        return new Promise<boolean>((resolve) => {
          reconnectResolvers.push(resolve);
        });
      }
      setStatus("connecting");
      return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const wrappedResolve = (success: boolean) => {
          if (timer) clearTimeout(timer);
          resolve(success);
        };
        // 8-second safety fallback in case network hangs without firing onerror
        timer = setTimeout(() => {
          const idx = reconnectResolvers.indexOf(wrappedResolve);
          if (idx !== -1) reconnectResolvers.splice(idx, 1);
          setStatus("disconnected");
          resolve(false);
        }, 8000);

        reconnectResolvers.push(wrappedResolve);
        setReconnectTrigger((prev) => prev + 1);
      });
    },
    clearEvents: () => setEvents([]),
  };
});

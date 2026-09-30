import { useNavigate, useParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Show, type Component } from "solid-js";

import { Badge, Button, Card } from "@pockrew/pwr-ui/core";
import { ArrowLeft, Key, Reload } from "@pockrew/pwr-ui/icons";

import { IngressAuthCard } from "~/components/tunnel/ingress-auth-card";
import { RoutesCard } from "~/components/tunnel/routes-card";
import { fetchTunnels } from "~/libs/api-client";
import { fetchDeliveryStatus } from "~/libs/tunnel-client";

/** One tunnel: its delivery backlog, ingress authentication, and collections/endpoints. */
export const TunnelDetailPage: Component = () => {
  const params = useParams<{ tunnelId: string }>();
  const navigate = useNavigate();
  const tunnels = createQuery(() => ({ queryKey: ["tunnels"], queryFn: () => fetchTunnels() }));
  const tunnel = () => tunnels.data?.find((t) => t.id === params.tunnelId);
  const status = createQuery(() => ({
    queryKey: ["tunnels", params.tunnelId, "delivery-status"],
    queryFn: () => fetchDeliveryStatus(params.tunnelId),
    refetchInterval: 10_000,
  }));

  const counts = () => {
    const data = status.data;
    if (!data) return [];
    return [
      { label: "Pending deliveries", value: data.pendingDeliveries, hint: "Waiting for an agent" },
      {
        label: "Blocked",
        value: data.blockedDeliveries,
        hint: "Endpoint paused, inactive or deleted",
      },
      { label: "Unmatched events", value: data.unmatchedEvents, hint: "No endpoint matched" },
      {
        label: "Being prepared",
        value: data.unpreparedEvents,
        hint: "Stored, deliveries not created yet",
      },
    ];
  };

  return (
    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 md:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate("/tunnels")}
            aria-label="Back to tunnels"
          >
            <ArrowLeft class="size-4" />
          </Button>
          <Show when={tunnel()} fallback={<h1 class="text-xl font-bold">Tunnel</h1>}>
            {(t) => (
              <>
                <h1 class="text-foreground text-xl font-bold tracking-tight">{t().name}</h1>
                <Badge variant="secondary" class="font-mono">
                  /ingress/{t().slug}
                </Badge>
                <Badge variant={t().isActive ? "success" : "secondary"}>
                  {t().isActive ? "accepting webhooks" : "inactive"}
                </Badge>
              </>
            )}
          </Show>
        </div>
        <Button
          variant="outline"
          size="sm"
          pill
          onClick={() => navigate(`/tunnels/${params.tunnelId}/keys`)}
        >
          <Key class="size-4" />
          <span>Keys</span>
        </Button>
      </div>

      <Show when={tunnels.isSuccess && !tunnel()}>
        <p class="text-destructive text-sm">This tunnel does not exist or was deleted.</p>
      </Show>

      <Show when={tunnel()}>
        {(t) => (
          <>
            <Card class="p-4">
              <div class="mb-3 flex items-center justify-between">
                <h2 class="text-foreground text-base font-bold">Delivery status</h2>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void status.refetch()}
                  aria-label="Refresh"
                >
                  <Reload class="size-3.5" />
                </Button>
              </div>
              <Show when={status.isError}>
                <p class="text-destructive text-sm">{status.error?.message}</p>
              </Show>
              <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                {counts().map((count) => (
                  <div class="border-border rounded-md border p-3" title={count.hint}>
                    <div class="text-muted-foreground text-xs">{count.label}</div>
                    <div class="text-foreground font-mono text-xl font-bold">{count.value}</div>
                  </div>
                ))}
              </div>
            </Card>
            <IngressAuthCard tunnelId={t().id} />
            <RoutesCard tunnelId={t().id} slug={t().slug} />
          </>
        )}
      </Show>
    </div>
  );
};

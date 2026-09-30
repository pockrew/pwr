import { createMutation, createQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show, type Component } from "solid-js";
import { toast } from "solid-sonner";

import {
  AgentProxyUpdateSchema,
  type ProxyConfig,
  type ProxyMode,
} from "@pockrew/pwr-shared/schemas";
import { Button, TextField } from "@pockrew/pwr-ui/core";

import { fetchProxySettings, saveProxySettings } from "~/libs/api-client";
import { queryClient } from "~/libs/query-client";

const proxyKey = ["agent", "proxy"] as const;

const MODES: { id: ProxyMode; label: string; description: string }[] = [
  {
    id: "auto",
    label: "Auto",
    description: "Use HTTP(S)_PROXY and NO_PROXY from the agent's environment.",
  },
  { id: "manual", label: "Manual", description: "Use the proxy URLs below." },
  { id: "disabled", label: "Direct", description: "Never use a proxy." },
];

const optional = (value: string): string | undefined => value.trim() || undefined;

/**
 * Proxy for the agent's own outbound connections: the PWR server (relay and config sync) and
 * update downloads. Calls to local targets never go through it. Values come from and save to
 * the agent's config.toml; nothing is cached in the browser.
 */
export const ProxySettings: Component = () => {
  const settings = createQuery(
    () => ({ queryKey: proxyKey, queryFn: fetchProxySettings }),
    () => queryClient,
  );
  const [mode, setMode] = createSignal<ProxyMode>("auto");
  const [httpProxy, setHttpProxy] = createSignal("");
  const [httpsProxy, setHttpsProxy] = createSignal("");
  const [noProxy, setNoProxy] = createSignal("");
  const [caCertPath, setCaCertPath] = createSignal("");

  // Load the agent's saved values whenever they (re)load.
  createEffect(() => {
    const config = settings.data?.config;
    if (!config) return;
    setMode(config.mode);
    setHttpProxy(config.httpProxy ?? "");
    setHttpsProxy(config.httpsProxy ?? "");
    setNoProxy(config.noProxy);
    setCaCertPath(config.caCertPath ?? "");
  });

  const draft = () =>
    AgentProxyUpdateSchema.safeParse({
      mode: mode(),
      httpProxy: optional(httpProxy()),
      httpsProxy: optional(httpsProxy()),
      noProxy: noProxy().trim() || "localhost,127.0.0.1,::1",
      caCertPath: optional(caCertPath()),
    });

  const save = createMutation(
    () => ({
      mutationFn: (config: ProxyConfig) => saveProxySettings(config),
      onSuccess: () => {
        toast.success("Proxy settings saved", {
          description: "They apply to new connections; reconnect a tunnel to use them now.",
        });
        void queryClient.invalidateQueries({ queryKey: proxyKey });
      },
      onError: (error) => toast.error(error.message),
    }),
    () => queryClient,
  );

  return (
    <Show
      when={settings.data}
      fallback={
        <p class="text-muted-foreground text-sm">
          {settings.isError
            ? `Could not load proxy settings: ${settings.error?.message}`
            : "Loading proxy settings…"}
        </p>
      }
    >
      {(data) => (
        <form
          class="max-w-md space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = draft();
            if (parsed.success) save.mutate(parsed.data);
          }}
        >
          <fieldset class="space-y-2">
            <legend class="text-foreground text-sm font-medium">Mode</legend>
            <div class="flex gap-1">
              <For each={MODES}>
                {(option) => (
                  <Button
                    type="button"
                    size="sm"
                    variant={mode() === option.id ? "default" : "outline"}
                    onClick={() => setMode(option.id)}
                  >
                    {option.label}
                  </Button>
                )}
              </For>
            </div>
            <p class="text-muted-foreground text-xs">
              {MODES.find((option) => option.id === mode())?.description}
            </p>
          </fieldset>

          <Show when={mode() === "auto"}>
            <dl class="bg-muted/30 border-border grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md border p-3 font-mono text-xs">
              <dt class="text-muted-foreground">HTTP_PROXY</dt>
              <dd>{data().detected.httpProxy ?? "not set"}</dd>
              <dt class="text-muted-foreground">HTTPS_PROXY</dt>
              <dd>{data().detected.httpsProxy ?? "not set"}</dd>
              <dt class="text-muted-foreground">NO_PROXY</dt>
              <dd>{data().detected.noProxy ?? "not set"}</dd>
            </dl>
          </Show>

          <Show when={mode() === "manual"}>
            <TextField.Root>
              <TextField.Label>HTTP proxy URL</TextField.Label>
              <TextField.Input
                value={httpProxy()}
                onInput={(event) => setHttpProxy(event.currentTarget.value)}
                placeholder="http://proxy.corp:8080"
                class="font-mono text-sm"
              />
            </TextField.Root>
            <TextField.Root>
              <TextField.Label>HTTPS proxy URL</TextField.Label>
              <TextField.Input
                value={httpsProxy()}
                onInput={(event) => setHttpsProxy(event.currentTarget.value)}
                placeholder="http://proxy.corp:8443"
                class="font-mono text-sm"
              />
            </TextField.Root>
            <TextField.Root>
              <TextField.Label>NO_PROXY (bypass list)</TextField.Label>
              <TextField.Input
                value={noProxy()}
                onInput={(event) => setNoProxy(event.currentTarget.value)}
                placeholder="localhost,127.0.0.1,::1"
                class="font-mono text-sm"
              />
            </TextField.Root>
          </Show>

          <TextField.Root>
            <TextField.Label>Custom CA certificate path (optional)</TextField.Label>
            <TextField.Input
              value={caCertPath()}
              onInput={(event) => setCaCertPath(event.currentTarget.value)}
              placeholder="/path/to/corporate-ca.pem"
              class="font-mono text-sm"
            />
            <TextField.Description>
              Trusted for the agent's TLS connections to the server, in every mode.
            </TextField.Description>
          </TextField.Root>

          <Show when={!draft().success}>
            <p class="text-destructive text-xs">
              {draft().error?.issues[0]?.message ?? "Check the proxy URLs (http:// or https://)."}
            </p>
          </Show>

          <Button type="submit" pill disabled={save.isPending || !draft().success}>
            {save.isPending ? "Saving…" : "Save proxy settings"}
          </Button>
        </form>
      )}
    </Show>
  );
};

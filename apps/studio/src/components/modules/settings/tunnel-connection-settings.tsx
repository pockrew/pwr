import { createForm } from "@tanstack/solid-form";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  Show,
  untrack,
  type Component,
} from "solid-js";
import { toast } from "solid-sonner";

import type { AgentRelayConnect } from "@pockrew/pwr-shared/schemas";
import { Button, PasswordInput, TextField } from "@pockrew/pwr-ui/core";
import { Plus } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { TunnelSelect } from "~/components/modules/tunnel-select";
import {
  connectTunnel,
  disconnectTunnel,
  fetchRelayKeyStatus,
  pauseTunnel,
  resumeTunnel,
  testTunnelConnection,
} from "~/libs/api-client";
import {
  SESSION_ERRORS,
  TEST_MESSAGES,
  validateServerUrl,
  validateSlug,
} from "~/libs/tunnel-connection";
import { tunnelStore } from "~/stores/tunnel.store";

const EMPTY = { serverUrl: "", slug: "", name: "", apiKey: "" };

/** Connects the agent to a server tunnel: server URL, slug, and relay key, with a key check. */
export const TunnelConnectionSettings: Component = () => {
  const [isNew, setIsNew] = createSignal(false);
  const [testResult, setTestResult] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [isTesting, setIsTesting] = createSignal(false);
  // Editing the selected tunnel unless adding one (or the agent has none yet).
  const editing = () => (isNew() ? undefined : tunnelStore.session);
  // Memo: the 10s list poll yields new session objects; only an ID change should reset the form.
  const editingId = createMemo(() => editing()?.tunnelId);
  const [keyStatus] = createResource(
    editingId,
    async (id) => (await fetchRelayKeyStatus(id)).configured,
  );

  const form = createForm(() => ({
    defaultValues: EMPTY,
    onSubmit: async ({ value }) => {
      const slug = value.slug.trim();
      const tunnelId = value.name.trim() || slug;
      const apiKey = value.apiKey.trim();
      const payload: AgentRelayConnect = { tunnelId, slug, serverWsUrl: value.serverUrl.trim() };
      if (apiKey) payload.apiKey = apiKey;
      // The key goes only to the agent's local DB; report success only after the agent accepts.
      try {
        await connectTunnel(payload);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "The agent did not save the tunnel");
        return;
      }
      await tunnelStore.refresh();
      tunnelStore.select(tunnelId);
      setIsNew(false);
      toast.success(`Tunnel "${tunnelId}" saved; connecting...`);
    },
  }));

  // Load the selected tunnel's saved values; the key is never read back from the agent.
  createEffect(
    on(editingId, () => {
      const session = untrack(editing);
      setTestResult(null);
      form.reset(
        session
          ? {
              serverUrl: session.serverWsUrl,
              slug: session.slug ?? session.tunnelId,
              name: session.tunnelId,
              apiKey: "",
            }
          : EMPTY,
      );
    }),
  );

  const runTest = async () => {
    const { serverUrl, slug, apiKey } = form.state.values;
    const invalid = validateServerUrl(serverUrl) ?? validateSlug(slug);
    if (invalid) {
      setTestResult({ ok: false, text: invalid });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const payload = { serverWsUrl: serverUrl.trim(), slug: slug.trim() };
      const res = await testTunnelConnection(
        apiKey.trim() ? { ...payload, apiKey: apiKey.trim() } : payload,
      );
      const status = res.result === "server_error" && res.status ? ` (HTTP ${res.status})` : "";
      setTestResult({ ok: res.result === "ok", text: TEST_MESSAGES[res.result] + status });
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        text: err instanceof Error ? err.message : "The agent could not run the test",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const [controlBusy, setControlBusy] = createSignal(false);

  /** Run a tunnel control on the agent, then re-read the session; success only after it answers. */
  const control = async (action: () => Promise<unknown>, done: string) => {
    setControlBusy(true);
    try {
      await action();
      await tunnelStore.refresh();
      toast.success(done);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "The agent refused the request");
    } finally {
      setControlBusy(false);
    }
  };

  const togglePause = (id: string, paused: boolean) =>
    control(
      () => (paused ? resumeTunnel(id) : pauseTunnel(id)),
      paused ? "Deliveries resumed" : "Deliveries paused; new work is held until you resume",
    );

  const disconnect = (id: string) => {
    const confirmed = window.confirm(
      `Disconnect "${id}"?\n\nThe agent stops receiving deliveries for it; the server keeps them pending until you connect again. Local history, targets and secrets are kept.`,
    );
    if (confirmed) void control(() => disconnectTunnel(id), `Disconnected "${id}"`);
  };

  const takeOver = (session: { tunnelId: string; slug?: string; serverWsUrl: string }) => {
    const confirmed = window.confirm(
      `Take over "${session.tunnelId}"?\n\nThe agent that owns it now is disconnected, and deliveries come to this machine instead.`,
    );
    if (!confirmed) return;
    void control(
      () =>
        connectTunnel({
          tunnelId: session.tunnelId,
          slug: session.slug ?? session.tunnelId,
          serverWsUrl: session.serverWsUrl,
          takeover: true,
        }),
      `Took over "${session.tunnelId}"`,
    );
  };

  const sessionStatus = () => {
    const session = editing();
    if (!session) return "";
    const error = session.lastError ? `: ${SESSION_ERRORS[session.lastError]}` : "";
    return `${session.status}${error}`;
  };

  return (
    <div class="space-y-4">
      <div class="flex max-w-md items-end gap-2">
        <TunnelSelect class="min-w-0 flex-1" triggerClass="text-sm" label="Tunnel" />
        <Button
          type="button"
          variant="outline"
          pill
          class="gap-1"
          disabled={!editing()}
          onClick={() => setIsNew(true)}
        >
          <Plus class="size-4" />
          New
        </Button>
      </div>
      <Show when={editing()}>
        {(session) => (
          <div class="flex max-w-md flex-wrap items-center gap-2">
            <p class="text-muted-foreground flex-1 font-mono text-xs">
              Status: {sessionStatus()}
              {session().isPaused ? " (deliveries paused)" : ""}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              pill
              disabled={controlBusy()}
              onClick={() => void togglePause(session().tunnelId, Boolean(session().isPaused))}
            >
              {session().isPaused ? "Resume deliveries" : "Pause deliveries"}
            </Button>
            <Show when={session().lastError === "tunnel_in_use"}>
              <Button
                type="button"
                size="sm"
                pill
                disabled={controlBusy()}
                onClick={() => takeOver(session())}
              >
                Take over
              </Button>
            </Show>
            <Show when={session().status !== "disconnected"}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                pill
                disabled={controlBusy()}
                onClick={() => disconnect(session().tunnelId)}
              >
                Disconnect
              </Button>
            </Show>
          </div>
        )}
      </Show>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        class="space-y-4"
      >
        <form.Field
          name="serverUrl"
          validators={{ onChange: ({ value }) => validateServerUrl(value) }}
        >
          {(field) => (
            <FormTextField
              label="Server URL"
              description="The PWR server this tunnel was created on"
              // Changing server/slug would re-point this alias and strand its local history.
              disabled={Boolean(editing())}
              placeholder="https://pwr.example.com or http://localhost:18787"
              value={field().state.value}
              error={field().state.meta.errors[0]}
              onInput={(v) => field().handleChange(v)}
              onBlur={field().handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="slug" validators={{ onChange: ({ value }) => validateSlug(value) }}>
          {(field) => (
            <FormTextField
              label="Tunnel slug"
              description="The tunnel's slug as shown in Admin"
              disabled={Boolean(editing())}
              placeholder="my-tunnel"
              value={field().state.value}
              error={field().state.meta.errors[0]}
              onInput={(v) => field().handleChange(v)}
              onBlur={field().handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="name">
          {(field) => (
            <FormTextField
              label="Local name (optional)"
              description="How this tunnel is named on this machine; defaults to the slug"
              placeholder="my-tunnel"
              value={field().state.value}
              disabled={Boolean(editing())}
              onInput={(v) => field().handleChange(v)}
              onBlur={field().handleBlur}
            />
          )}
        </form.Field>

        <form.Field
          name="apiKey"
          validators={{
            onSubmit: ({ value }) =>
              value.trim() || keyStatus() ? undefined : "Relay key is required",
          }}
        >
          {(field) => (
            <div class="max-w-md space-y-1">
              <PasswordInput
                label="Relay key"
                hint={
                  keyStatus()
                    ? "A key is saved in the agent; leave blank to keep it"
                    : "The tunnel's outbound (agent) key from Admin; stored only in the local agent"
                }
                error={field().state.meta.errors[0] ? String(field().state.meta.errors[0]) : null}
                value={field().state.value}
                onInput={(e) => field().handleChange(e.currentTarget.value)}
                onBlur={field().handleBlur}
                placeholder="pwr_outbound_..."
                class="font-mono text-xs"
                autocomplete="off"
              />
            </div>
          )}
        </form.Field>

        <Show when={testResult()}>
          {(result) => (
            <output
              class={cn(
                "block max-w-md rounded-2xl border px-3 py-2 text-sm",
                result().ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {result().text}
            </output>
          )}
        </Show>

        <div class="flex max-w-md gap-2 pt-2">
          <Button type="button" variant="outline" pill disabled={isTesting()} onClick={runTest}>
            {isTesting() ? "Testing..." : "Test connection"}
          </Button>
          <Button type="submit" pill>
            Save & connect
          </Button>
          <Show when={isNew() && tunnelStore.tunnels.length > 0}>
            <Button type="button" variant="ghost" pill onClick={() => setIsNew(false)}>
              Cancel
            </Button>
          </Show>
        </div>
      </form>
    </div>
  );
};

const FormTextField: Component<{
  label: string;
  description: string;
  placeholder: string;
  value: string;
  error?: unknown;
  disabled?: boolean;
  onInput: (value: string) => void;
  onBlur: () => void;
}> = (props) => (
  <div class="space-y-1">
    <TextField.Root
      class="max-w-md"
      validationState={props.error ? "invalid" : "valid"}
      disabled={props.disabled}
    >
      <TextField.Label>{props.label}</TextField.Label>
      <TextField.Input
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onBlur={() => props.onBlur()}
        placeholder={props.placeholder}
        class="font-mono text-sm"
      />
      <TextField.Description>{props.description}</TextField.Description>
    </TextField.Root>
    <Show when={props.error}>
      <p class="text-destructive pl-1 text-xs">{String(props.error)}</p>
    </Show>
  </div>
);

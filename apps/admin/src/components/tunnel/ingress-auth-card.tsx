import { createMutation, createQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show, type Component } from "solid-js";

import {
  HmacSigningOptionsSchema,
  type HmacSigningOptions,
  type IngressSigningStatus,
} from "@pockrew/pwr-shared/schemas";
import { Badge, Button, Card, Input, PasswordInput, Select, toast } from "@pockrew/pwr-ui/core";
import { cn } from "@pockrew/pwr-ui/libs";

import { queryClient } from "~/libs/query-client";
import {
  fetchIngressAuth,
  removeIngressSigning,
  setIngressSigning,
  type IngressAuth,
} from "~/libs/tunnel-client";

const MODES: {
  id: IngressSigningStatus["provider"];
  label: string;
  description: string;
  secretLabel?: string;
}[] = [
  {
    id: "api_key",
    label: "API key header",
    description:
      "Providers send the inbound key in the x-api-key header; only for providers that let you add custom headers.",
  },
  {
    id: "github",
    label: "GitHub",
    description: "Verifies X-Hub-Signature-256 with the webhook secret.",
    secretLabel: "GitHub webhook secret",
  },
  {
    id: "stripe",
    label: "Stripe",
    description:
      "Verifies Stripe-Signature (t=…, v1=…) with the endpoint signing secret (whsec_…); requests older than 5 minutes are rejected.",
    secretLabel: "Stripe signing secret",
  },
  {
    id: "standard_webhooks",
    label: "Standard Webhooks / Svix",
    description:
      "For Clerk, Resend and other Svix-based providers; verifies webhook-signature (or svix-signature) with the whsec_… secret; older than 5 minutes rejected.",
    secretLabel: "Standard Webhooks secret (whsec_…)",
  },
  {
    id: "shopify",
    label: "Shopify",
    description: "Verifies X-Shopify-Hmac-Sha256 with the app's client secret.",
    secretLabel: "Shopify client secret",
  },
  {
    id: "slack",
    label: "Slack",
    description:
      "Verifies X-Slack-Signature with the app signing secret; older than 5 minutes rejected.",
    secretLabel: "Slack signing secret",
  },
  {
    id: "hmac",
    label: "Custom HMAC",
    description:
      "For other providers that sign the raw body (for example Linear, Intercom, Typeform).",
    secretLabel: "HMAC secret",
  },
];

/**
 * How the server authenticates webhooks for this tunnel. A provider signature replaces the API
 * key for the whole tunnel; the secret is encrypted on the server and never shown again.
 */
export const IngressAuthCard: Component<{ tunnelId: string }> = (props) => {
  const key = () => ["tunnels", props.tunnelId, "ingress-auth"] as const;
  const auth = createQuery(() => ({
    queryKey: key(),
    queryFn: () => fetchIngressAuth(props.tunnelId),
  }));
  const [choice, setChoice] = createSignal<IngressSigningStatus["provider"] | null>(null);
  const [secret, setSecret] = createSignal("");
  const [hmacOptions, setHmacOptions] = createSignal<HmacSigningOptions>({
    header: "",
    algorithm: "sha256",
    encoding: "hex",
    prefix: "",
  });

  const selected = () => choice() ?? auth.data?.provider ?? "api_key";

  // Pre-fill the custom HMAC fields from the saved options whenever they (re)load.
  const initHmacOptions = () => {
    if (auth.data?.provider === "hmac" && auth.data?.options) {
      setHmacOptions(auth.data.options);
    }
  };
  createEffect(initHmacOptions);

  const onSaved = (saved: IngressAuth, message: string) => {
    queryClient.setQueryData(key(), saved);
    setChoice(null);
    setSecret("");
    initHmacOptions();
    toast.success(message);
  };

  const save = createMutation(() => ({
    mutationFn: async (): Promise<IngressAuth> => {
      const provider = selected();
      if (provider === "api_key") return removeIngressSigning(props.tunnelId);

      // An empty custom HMAC secret keeps the saved one; only the options change.
      if (provider === "hmac") {
        return setIngressSigning(props.tunnelId, {
          provider,
          ...(secret().trim() ? { secret: secret().trim() } : {}),
          options: hmacOptions(),
        });
      }

      return setIngressSigning(props.tunnelId, { provider, secret: secret().trim() });
    },
    onSuccess: (saved) => {
      const label = MODES.find((m) => m.id === saved.provider)?.label ?? saved.provider;
      onSaved(
        saved,
        saved.provider === "api_key"
          ? "Webhooks now need the x-api-key header"
          : `Webhooks are now verified with ${label}`,
      );
    },
    onError: (error) => toast.error(error.message),
  }));

  const needsSecret = () => selected() !== "api_key";
  const isHmac = () => selected() === "hmac";
  const keepsSavedSecret = () => isHmac() && auth.data?.provider === "hmac";

  const hmacValidation = () => HmacSigningOptionsSchema.safeParse(hmacOptions());
  const hmacValid = () => hmacValidation().success;
  const hmacError = () => hmacValidation().error?.issues[0]?.message;

  const changed = () => {
    if (selected() !== auth.data?.provider) return true;
    if (needsSecret() && secret().trim()) return true;
    if (isHmac() && auth.data?.options) {
      return JSON.stringify(hmacOptions()) !== JSON.stringify(auth.data.options);
    }
    return false;
  };

  const submit = () => {
    const warning =
      selected() === "api_key"
        ? "Switch back to API keys?\n\nSigned deliveries from the provider will be rejected until it sends an x-api-key header."
        : `Use ${MODES.find((m) => m.id === selected())?.label} for this tunnel?\n\nRequests with only an x-api-key header will be rejected.`;
    if (window.confirm(warning)) save.mutate();
  };

  return (
    <Card class="space-y-4 p-4">
      <div class="flex items-center gap-2">
        <h2 class="text-foreground text-base font-bold">Ingress authentication</h2>
        <Show when={auth.data}>
          {(data) => (
            <Badge variant="secondary" class="font-mono text-xs">
              {MODES.find((mode) => mode.id === data().provider)?.label}
            </Badge>
          )}
        </Show>
      </div>
      <Show when={auth.isError}>
        <p class="text-destructive text-sm">{auth.error?.message}</p>
      </Show>
      <Show when={auth.data && !auth.data.available}>
        <p class="text-muted-foreground text-sm">
          Provider signatures need <code>WEBHOOK_SIGNING_ENCRYPTION_KEY</code> (64 hex characters)
          on the server; set it and restart the server to enable them.
        </p>
      </Show>
      <Show when={auth.data}>
        <div class="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
          <For each={MODES}>
            {(mode) => (
              <button
                type="button"
                disabled={mode.id !== "api_key" && !auth.data?.available}
                onClick={() => {
                  setChoice(mode.id);
                  if (mode.id === "hmac" && auth.data?.provider === "hmac" && auth.data?.options) {
                    setHmacOptions(auth.data.options);
                  }
                }}
                class={cn(
                  "cursor-pointer rounded-md border p-3 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  selected() === mode.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <div class="text-foreground text-sm font-semibold">{mode.label}</div>
                <p class="text-muted-foreground mt-1">{mode.description}</p>
              </button>
            )}
          </For>
        </div>
        <Show when={needsSecret()}>
          <div class="max-w-md space-y-3">
            <PasswordInput
              label={MODES.find((mode) => mode.id === selected())?.secretLabel ?? "Secret"}
              hint={
                keepsSavedSecret()
                  ? "A secret is saved; leave this empty to keep it."
                  : auth.data?.provider === selected()
                    ? "A secret is saved; enter a new one only to replace it."
                    : "Stored encrypted on the server and never displayed again."
              }
              value={secret()}
              onInput={(event) => setSecret(event.currentTarget.value)}
              autocomplete="off"
              class="font-mono text-xs"
            />
            <Show when={isHmac()}>
              <div class="border-border bg-muted/20 space-y-2 rounded-md border p-3">
                <Input
                  label="Header name"
                  placeholder="linear-signature"
                  value={hmacOptions().header}
                  onInput={(e) =>
                    setHmacOptions((prev) => ({ ...prev, header: e.currentTarget.value }))
                  }
                  class="h-8 text-xs"
                />
                <div class="grid grid-cols-2 gap-2">
                  <Select<"sha256" | "sha1" | "sha512">
                    options={["sha256", "sha1", "sha512"]}
                    value={hmacOptions().algorithm}
                    onChange={(val) => {
                      if (val) setHmacOptions((prev) => ({ ...prev, algorithm: val }));
                    }}
                  >
                    <Select.Label class="text-foreground text-xs font-medium">
                      Algorithm
                    </Select.Label>
                    <Select.Trigger class="h-8 text-xs" />
                    <Select.Content />
                  </Select>
                  <Select<"hex" | "base64">
                    options={["hex", "base64"]}
                    value={hmacOptions().encoding}
                    onChange={(val) => {
                      if (val) setHmacOptions((prev) => ({ ...prev, encoding: val }));
                    }}
                  >
                    <Select.Label class="text-foreground text-xs font-medium">
                      Encoding
                    </Select.Label>
                    <Select.Trigger class="h-8 text-xs" />
                    <Select.Content />
                  </Select>
                </div>
                <Input
                  label="Prefix (optional)"
                  placeholder="sha256="
                  value={hmacOptions().prefix}
                  onInput={(e) =>
                    setHmacOptions((prev) => ({ ...prev, prefix: e.currentTarget.value }))
                  }
                  class="h-8 text-xs"
                />
                <Show when={hmacOptions().header.trim() && !hmacValid()}>
                  <p class="text-destructive text-xs">{hmacError()}</p>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
        <Button
          size="sm"
          pill
          disabled={
            !changed() ||
            save.isPending ||
            (needsSecret() && !keepsSavedSecret() && !secret().trim()) ||
            (isHmac() && !hmacValid())
          }
          onClick={submit}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </Show>
    </Card>
  );
};

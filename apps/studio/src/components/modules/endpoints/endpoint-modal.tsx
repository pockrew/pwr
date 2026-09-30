import { createEffect, createSignal, For, Show, type Component } from "solid-js";

import {
  EndpointPathSchema,
  EndpointTargetSchema,
  LocalEndpointCredentialSchema,
  type CreateLocalEndpointInput,
  type UpdateLocalEndpointInput,
} from "@pockrew/pwr-shared/schemas";
import { Button, Checkbox, Input, PasswordInput, Sheet } from "@pockrew/pwr-ui/core";
import { EventMessage } from "@pockrew/pwr-ui/icons";

import { endpointsStore, type EndpointItem } from "~/stores/endpoints.store";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string;
  endpoint?: EndpointItem | null;
}

type SecretAction = "keep" | "set" | "remove";

const SECRET_ACTIONS: { id: SecretAction; label: string }[] = [
  { id: "keep", label: "Keep" },
  { id: "set", label: "Replace" },
  { id: "remove", label: "Remove" },
];

/**
 * Create or edit an endpoint: its routing path (synced to the server), its local target and its
 * target secret (both stay in this agent). The target and secret are saved in one request.
 */
export const EndpointModal: Component<Props> = (props) => {
  const [pathName, setPathName] = createSignal("");
  const [target, setTarget] = createSignal("");
  const [isActive, setIsActive] = createSignal(true);
  const [isPaused, setIsPaused] = createSignal(false);
  const [secretAction, setSecretAction] = createSignal<SecretAction>("keep");
  const [headerName, setHeaderName] = createSignal("authorization");
  const [secretValue, setSecretValue] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  const hasSecret = () => props.endpoint?.secret.configured ?? false;

  createEffect(() => {
    if (!props.isOpen) return;
    const ep = props.endpoint;
    setPathName(ep?.pathName ?? "");
    setTarget(ep?.localTarget ?? "");
    setIsActive(ep?.isActive ?? true);
    setIsPaused(ep?.isPaused ?? false);
    setSecretAction(ep?.secret.configured ? "keep" : "remove");
    setHeaderName(ep?.secret.headerName ?? "authorization");
    setSecretValue("");
  });

  const pathError = () => {
    const parsed = EndpointPathSchema.safeParse(pathName());
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid path");
  };
  const targetError = () => {
    if (!target().trim()) return null;
    const parsed = EndpointTargetSchema.safeParse(target().trim());
    return parsed.success ? null : "Use an http:// or https:// URL without credentials";
  };
  const credential = () =>
    LocalEndpointCredentialSchema.safeParse({ headerName: headerName(), secret: secretValue() });
  const secretError = () => {
    if (secretAction() !== "set") return null;
    const parsed = credential();
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid secret");
  };
  const invalid = () => Boolean(pathError() || targetError() || secretError());

  const ingressUrl = () => {
    const base = endpointsStore.ingressBaseUrl;
    const path = pathName().trim().replace(/^\/+/, "");
    return base && path ? `${base}/target/${path}` : null;
  };

  const submit = async () => {
    if (invalid()) return;
    setSaving(true);
    const parsedPath = EndpointPathSchema.parse(pathName());
    const cleanTarget = target().trim();
    const parsedSecret = secretAction() === "set" ? credential() : null;
    const secret = parsedSecret?.success ? parsedSecret.data : undefined;
    let saved: boolean;
    if (props.endpoint) {
      const input: UpdateLocalEndpointInput = {
        pathName: parsedPath,
        localTarget: cleanTarget || null,
        isActive: isActive(),
        isPaused: isPaused(),
      };
      if (secret) input.secret = secret;
      else if (secretAction() === "remove" && hasSecret()) input.secret = null;
      saved = await endpointsStore.updateEndpoint(props.endpoint, input);
    } else {
      const input: CreateLocalEndpointInput = {
        pathName: parsedPath,
        isActive: isActive(),
        isPaused: isPaused(),
      };
      if (cleanTarget) input.localTarget = cleanTarget;
      if (secret) input.secret = secret;
      saved = await endpointsStore.createEndpoint(props.collectionId, input);
    }
    setSaving(false);
    if (saved) props.onClose();
  };

  return (
    <Sheet.Root
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Sheet.Content side="right" class="max-w-lg">
        <Sheet.Header class="h-11 shrink-0 flex-row items-center justify-between py-0">
          <div class="flex items-center gap-2">
            <div class="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
              <EventMessage class="size-4" />
            </div>
            <Sheet.Title>{props.endpoint ? "Edit Endpoint" : "Add Endpoint"}</Sheet.Title>
          </div>
        </Sheet.Header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          class="flex flex-1 flex-col overflow-hidden"
        >
          <div class="flex-1 space-y-4 overflow-y-auto p-4">
            <div class="space-y-1">
              <Input
                label="Path"
                value={pathName()}
                onInput={(event) => setPathName(event.currentTarget.value)}
                placeholder="/payments"
                required
                class="rounded-full font-mono"
                hint={
                  ingressUrl() ? `Ingress: ${ingressUrl()}` : "Routing path; synced to the server"
                }
              />
              <Show when={pathName() && pathError()}>
                <p class="text-destructive pl-1 text-xs">{pathError()}</p>
              </Show>
            </div>

            <div class="space-y-1">
              <Input
                label="Target URL"
                value={target()}
                onInput={(event) => setTarget(event.currentTarget.value)}
                placeholder="http://localhost:3000/webhooks"
                class="rounded-full font-mono"
                hint="Where this agent forwards deliveries. Empty: deliveries wait until one is set."
              />
              <Show when={targetError()}>
                <p class="text-destructive pl-1 text-xs">{targetError()}</p>
              </Show>
            </div>

            <fieldset class="border-border space-y-3 rounded-2xl border p-3">
              <legend class="text-foreground px-1 text-sm font-medium">Target secret</legend>
              <p class="text-muted-foreground text-xs">
                <Show
                  when={hasSecret()}
                  fallback="Optional. Stored only in this agent and sent as a header on every call to the target."
                >
                  A secret is stored in this agent and sent as the{" "}
                  <code class="font-mono">{props.endpoint?.secret.headerName}</code> header.
                </Show>
              </p>
              <div class="flex gap-1">
                <For
                  each={
                    hasSecret()
                      ? SECRET_ACTIONS
                      : [
                          { id: "remove" as const, label: "None" },
                          { id: "set" as const, label: "Add" },
                        ]
                  }
                >
                  {(option) => (
                    <Button
                      type="button"
                      size="xs"
                      variant={secretAction() === option.id ? "default" : "outline"}
                      onClick={() => setSecretAction(option.id)}
                    >
                      {option.label}
                    </Button>
                  )}
                </For>
              </div>
              <Show when={secretAction() === "set"}>
                <Input
                  label="Header name"
                  value={headerName()}
                  onInput={(event) => setHeaderName(event.currentTarget.value)}
                  placeholder="authorization"
                  class="rounded-full font-mono text-xs"
                />
                <PasswordInput
                  label="Secret value"
                  value={secretValue()}
                  onInput={(event) => setSecretValue(event.currentTarget.value)}
                  placeholder="Bearer …"
                  autocomplete="off"
                  class="font-mono text-xs"
                />
                <Show when={secretValue() && secretError()}>
                  <p class="text-destructive pl-1 text-xs">{secretError()}</p>
                </Show>
              </Show>
            </fieldset>

            <Checkbox checked={isActive()} onChange={setIsActive} class="flex items-start gap-2">
              <Checkbox.Control class="mt-0.5 size-4" />
              <div>
                <Checkbox.Label class="text-sm font-medium">Active</Checkbox.Label>
                <p class="text-muted-foreground text-xs">
                  An inactive endpoint gets no deliveries; the server still stores the webhooks.
                </p>
              </div>
            </Checkbox>
            <Checkbox checked={isPaused()} onChange={setIsPaused} class="flex items-start gap-2">
              <Checkbox.Control class="mt-0.5 size-4" />
              <div>
                <Checkbox.Label class="text-sm font-medium">Paused</Checkbox.Label>
                <p class="text-muted-foreground text-xs">
                  Deliveries are held and forwarded when the endpoint resumes.
                </p>
              </div>
            </Checkbox>
          </div>

          <Sheet.Footer class="bg-background">
            <Button type="button" variant="outline" pill onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" pill disabled={saving() || invalid() || !pathName().trim()}>
              {saving() ? "Saving…" : props.endpoint ? "Save changes" : "Add endpoint"}
            </Button>
          </Sheet.Footer>
        </form>
      </Sheet.Content>
    </Sheet.Root>
  );
};

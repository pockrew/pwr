import { createForm } from "@tanstack/solid-form";
import { createMutation } from "@tanstack/solid-query";
import { For, Show, type Component } from "solid-js";

import type { GenerateKeyInput, ManagementPermission } from "@pockrew/pwr-shared/schemas";
import { Button, Checkbox, Dialog, Input, Select, toast } from "@pockrew/pwr-ui/core";
import { Key } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { generateTunnelKey } from "~/libs/api-client";
import { queryClient } from "~/libs/query-client";

import { KEY_TYPE_OPTIONS, type KeyTypeOption } from "./key-types";

const ADMIN_PERMISSIONS: ManagementPermission[] = ["collections", "endpoints", "tunnel", "keys"];

const KeyTypeBadge: Component<{ option: KeyTypeOption }> = (props) => (
  <div class="flex items-center gap-2">
    <span class="font-medium">{props.option.label}</span>
    <span
      class={cn(
        "py-0.2 rounded-sm border px-1.5 font-mono text-[9px] font-semibold uppercase",
        props.option.colorClass,
      )}
    >
      {props.option.badge}
    </span>
  </div>
);

/**
 * Issues a tunnel credential. The raw token is handed to `onIssued` once and never stored here.
 */
export const IssueKeyDialog: Component<{
  tunnelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: (token: string) => void;
}> = (props) => {
  const generateKeyMutation = createMutation(() => ({
    mutationFn: (input: GenerateKeyInput) => generateTunnelKey(props.tunnelId, input),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["tunnels", props.tunnelId, "keys"] });
      close();
      props.onIssued(res.token);
      toast.success(`Key "${res.key.name}" generated successfully`);
    },
    onError: (err) => {
      toast.error("Failed to issue key", {
        description: err instanceof Error ? err.message : "Key generation failed",
      });
    },
  }));

  const keyForm = createForm(() => ({
    defaultValues: {
      keyType: "outbound" as KeyTypeOption["value"],
      name: "",
      permissions: ["collections", "endpoints"] as ManagementPermission[],
    },
    onSubmit: async ({ value }) => {
      const name = value.name.trim();
      if (!name) {
        toast.error("Key name is required");
        return;
      }
      if (value.keyType === "admin" && value.permissions.length === 0) {
        toast.error("Admin keys require at least one permission");
        return;
      }
      const input: GenerateKeyInput =
        value.keyType === "admin"
          ? { types: "admin", name, permissions: value.permissions }
          : { types: value.keyType, name };
      await generateKeyMutation.mutateAsync(input);
    },
  }));

  // Reactive read: getFieldValue() would not re-render when the key type changes.
  const keyType = keyForm.useStore((state) => state.values.keyType);

  // Every close path resets the form, so the dialog always opens blank.
  const close = () => {
    props.onOpenChange(false);
    keyForm.reset();
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
    >
      <Dialog.Content class="max-w-md">
        <Dialog.Header>
          <Dialog.Title class="flex items-center gap-2 text-sm font-bold">
            <Key class="text-primary size-4" />
            <span>Issue New Tunnel Credential</span>
          </Dialog.Title>
        </Dialog.Header>
        <div class="p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              keyForm.handleSubmit();
            }}
            class="space-y-4"
          >
            <keyForm.Field name="keyType">
              {(field) => (
                <Select<KeyTypeOption>
                  options={KEY_TYPE_OPTIONS}
                  optionValue="value"
                  optionTextValue="label"
                  value={KEY_TYPE_OPTIONS.find((o) => o.value === field().state.value) ?? null}
                  onChange={(val) => {
                    if (val) field().handleChange(val.value);
                  }}
                  itemComponent={(itemProps) => (
                    <Select.Item item={itemProps.item} class="py-2">
                      <KeyTypeBadge option={itemProps.item.rawValue} />
                    </Select.Item>
                  )}
                >
                  <Select.Label class="text-foreground text-xs font-medium">
                    Key Type / Role
                  </Select.Label>
                  <Select.Trigger class="h-8 text-xs" aria-label="Key Type / Role">
                    <Select.Value<KeyTypeOption>>
                      {(state) => {
                        const opt = state.selectedOption();
                        return opt ? <KeyTypeBadge option={opt} /> : "Select key type...";
                      }}
                    </Select.Value>
                  </Select.Trigger>
                  <Select.Content class="z-60" />
                </Select>
              )}
            </keyForm.Field>

            <keyForm.Field
              name="name"
              validators={{
                onChange: ({ value }) => (!value.trim() ? "Key name is required" : undefined),
              }}
            >
              {(field) => (
                <Input
                  label="Key Name / Identifier"
                  placeholder="e.g. Local Agent • MacBook Pro"
                  value={field().state.value}
                  onInput={(e) => field().handleChange(e.currentTarget.value)}
                  error={
                    field().state.meta.errors.length > 0
                      ? String(field().state.meta.errors[0])
                      : null
                  }
                  required
                  class="h-8 text-xs"
                />
              )}
            </keyForm.Field>

            {/* Admin Permissions Checkboxes */}
            <keyForm.Field name="permissions">
              {(field) => (
                <Show when={keyType() === "admin"}>
                  <div class="border-border bg-muted/20 space-y-1.5 rounded-md border p-2.5">
                    <span class="text-foreground text-xs font-semibold">Admin Permissions</span>
                    <div class="grid grid-cols-2 gap-2 pt-1">
                      <For each={ADMIN_PERMISSIONS}>
                        {(perm) => (
                          <Checkbox
                            checked={field().state.value.includes(perm)}
                            onChange={() => {
                              const current = field().state.value;
                              const next = current.includes(perm)
                                ? current.filter((p) => p !== perm)
                                : [...current, perm];
                              field().handleChange(next);
                            }}
                          >
                            <Checkbox.Control />
                            <Checkbox.Label class="font-mono text-xs">{perm}</Checkbox.Label>
                          </Checkbox>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              )}
            </keyForm.Field>

            <div class="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                pill
                onClick={close}
                disabled={generateKeyMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="cta"
                disabled={generateKeyMutation.isPending}
              >
                <Show when={generateKeyMutation.isPending} fallback="Generate Token">
                  <span class="border-primary-foreground mr-2 size-3 animate-spin rounded-full border-2 border-t-transparent" />
                  Generating...
                </Show>
              </Button>
            </div>
          </form>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
};

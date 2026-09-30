import { createSignal, Show, type Component } from "solid-js";

import { Button, Dialog, Input, toast } from "@pockrew/pwr-ui/core";
import { Check, Copy } from "@pockrew/pwr-ui/icons";

/** One-time display of a newly issued token; closing it drops the only copy held by Admin. */
export const RevealedTokenDialog: Component<{ token: string | null; onClose: () => void }> = (
  props,
) => {
  const [hasCopied, setHasCopied] = createSignal(false);

  const copyToken = () => {
    const token = props.token;
    if (!token) return;
    navigator.clipboard.writeText(token);
    setHasCopied(true);
    toast.success("Token copied to clipboard");
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <Dialog.Root open={Boolean(props.token)} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Content class="max-w-lg" hideCloseButton>
        <Dialog.Header>
          <Dialog.Title class="flex items-center gap-2 text-sm font-bold text-emerald-500">
            <Check class="size-4" />
            <span>Token Issued</span>
          </Dialog.Title>
        </Dialog.Header>
        <div class="space-y-4 p-5">
          <div class="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
            <span class="font-bold">Important:</span> Copy this token now. For security, it is
            hashed on the server and will never be displayed again.
          </div>

          <div class="space-y-1.5">
            <Input
              value={props.token ?? ""}
              readOnly
              label="Secret Key"
              rightAddon={
                <Button variant="ghost" size="icon-xs" pill onClick={copyToken}>
                  <Show when={hasCopied()} fallback={<Copy class="size-4" />}>
                    <Check class="size-4 text-emerald-500" />
                  </Show>
                </Button>
              }
            />
          </div>

          <div class="flex items-center justify-end pt-2">
            <Button size="sm" variant="cta" onClick={() => props.onClose()}>
              I have saved this token
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
};

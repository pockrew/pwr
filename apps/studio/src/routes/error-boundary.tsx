import { createEffect, type Component } from "solid-js";

import { Button } from "@pockrew/pwr-ui/core";
import { Alert, Reload } from "@pockrew/pwr-ui/icons";

interface Props {
  error: unknown;
  onRetry: () => void;
}

export const UnexpectedError: Component<Props> = (props) => {
  createEffect(() => {
    console.error("[boundary]", props.error);
  });

  return (
    <div class="mx-auto mt-12 max-w-lg p-6">
      <div class="flex flex-col items-center gap-4 text-center">
        <Alert class="text-destructive size-12" />
        <h1 class="text-foreground text-xl font-bold">Oops! Something went wrong.</h1>
        <p class="text-muted-foreground text-sm">
          This wasn&apos;t your fault. Try again, or reload the page. If it keeps happening, please
          restart the agents.
        </p>
        <div class="flex items-center gap-2 pt-2">
          <Button onclick={props.onRetry}>
            <Reload class="size-4" />
            <span>Retry</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

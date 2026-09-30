import { A } from "@solidjs/router";
import { createEffect, type Component } from "solid-js";

import { Alert, Home, Notes, Reload } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { Button } from "./button";
import { Card } from "./card";

export const UnexpectedError: Component<{
  error: unknown;
  onRetry: () => void;
}> = (props) => {
  createEffect(() => {
    console.error("[boundary]", props.error);
  });

  return (
    <Card radius="4xl" class="flex flex-col items-center gap-6 border-0 p-6">
      <Alert class="text-destructive size-14" />
      <h1 class="font-display text-title font-semi">Oops! Something went wrong.</h1>
      <p class="text-body text-center">
        This wasn&apos;t your fault. Try again, or reload the page. If it keeps happening, please
        restart the agents.
      </p>
      <div class="flex items-center gap-2">
        <Button onclick={props.onRetry}>
          <Reload />
          <span>Retry</span>
        </Button>
      </div>
    </Card>
  );
};

export const NotFound: Component = () => {
  createEffect(() => {
    console.error("[not-found]", window.location.pathname);
  });

  return (
    <Card radius="4xl" class="flex flex-col items-center gap-6 border-0 p-6">
      <span class="text-display text-muted-foreground font-mono leading-2 font-black tabular-nums">
        404
      </span>
      <h1 class="font-display text-title font-semi">Oops! We couldn't find this page.</h1>
      <p class="text-body text-center">
        The page you are looking for might have been removed, had its name changed, or is
        temporarily unavailable.
      </p>
      <div class="flex items-center gap-2">
        <Button as={A} href="/">
          <Home size="md" />
          <span>Back to Homepage</span>
        </Button>
      </div>
    </Card>
  );
};

export const Empty: Component<{
  label: string;
  description?: string;
  icon?: Component;
  class?: string;
}> = (props) => {
  const Icon = props.icon ?? Notes;

  return (
    <Card radius="4xl" class={cn("flex flex-col items-center gap-6 border-0 p-6", props.class)}>
      <Icon class="text-muted-foreground size-12" />
      <h1 class="font-display text-title font-semi">{props.label}</h1>
      <p class="text-body text-center">{props.description}</p>
    </Card>
  );
};

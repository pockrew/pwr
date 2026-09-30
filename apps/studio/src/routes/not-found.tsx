import { A } from "@solidjs/router";
import { createEffect, type Component } from "solid-js";

import { Button } from "@pockrew/pwr-ui/core";
import { Home } from "@pockrew/pwr-ui/icons";

export const NotFound: Component = () => {
  createEffect(() => {
    console.error("[not-found]", window.location.pathname);
  });

  return (
    <div class="mx-auto mt-12 max-w-lg p-6">
      <div class="flex flex-col items-center gap-4 text-center">
        <span class="text-muted-foreground font-mono text-4xl font-black tabular-nums">404</span>
        <h1 class="text-foreground text-xl font-bold">Oops! We couldn't find this page.</h1>
        <p class="text-muted-foreground text-sm">
          The page you are looking for might have been removed, had its name changed, or is
          temporarily unavailable.
        </p>
        <div class="flex items-center gap-2 pt-2">
          <Button as={A} href="/">
            <Home class="size-4" />
            <span>Back to Homepage</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

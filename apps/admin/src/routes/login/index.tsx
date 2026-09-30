import { useNavigate } from "@solidjs/router";
import { createForm } from "@tanstack/solid-form";
import { createSignal, Show, type Component } from "solid-js";

import { Button, Card, Input, PasswordInput, toast } from "@pockrew/pwr-ui/core";
import { Moon, Reload, Sun } from "@pockrew/pwr-ui/icons";

import { authStore } from "~/stores/auth.store";
import { themeStore } from "~/stores/theme.store";

export const LoginPage: Component = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = createSignal(false);

  const form = createForm(() => ({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      const password = value.password;
      if (!email || !password) {
        toast.error("Please enter email and password");
        return;
      }

      setIsSubmitting(true);
      try {
        await authStore.login(email, password);
        toast.success("Authenticated as Server Admin");
        navigate("/tunnels");
      } catch (err) {
        toast.error("Authentication failed", {
          description: err instanceof Error ? err.message : "Invalid email or password",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
  }));

  return (
    <div class="relative flex flex-1 items-center justify-center p-4">
      <div class="absolute top-4 right-4">
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground hover:text-foreground size-8"
          onClick={() => themeStore.toggleTheme()}
          aria-label="Toggle color theme"
        >
          <Show when={themeStore.theme === "dark"} fallback={<Moon class="size-4" />}>
            <Sun class="size-4" />
          </Show>
        </Button>
      </div>

      <Card radius="xl" class="border-border w-full max-w-sm p-6 shadow-lg">
        <div class="mb-6 space-y-2 text-center">
          <img
            src={`${import.meta.env.BASE_URL}assets/logo-mark.png`}
            alt="PWR Logo"
            class="mx-auto mb-2 h-12 w-auto object-contain dark:brightness-0 dark:invert"
          />
          <h2 class="text-foreground text-base font-bold tracking-tight">Server Control Center</h2>
          <p class="text-muted-foreground text-xs">
            Authenticate with your account admin credentials
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          class="space-y-4"
        >
          <form.Field
            name="email"
            validators={{
              onChange: ({ value }) => (!value.trim() ? "Email is required" : ""),
            }}
          >
            {(field) => (
              <Input
                label="Email"
                type="email"
                placeholder="admin@example.com"
                value={field().state.value}
                onInput={(e) => field().handleChange(e.currentTarget.value)}
                error={
                  field().state.meta.errors.length > 0 ? String(field().state.meta.errors[0]) : null
                }
                required
              />
            )}
          </form.Field>

          <form.Field
            name="password"
            validators={{
              onChange: ({ value }) => (!value ? "Password is required" : ""),
            }}
          >
            {(field) => (
              <PasswordInput
                label="Password"
                placeholder="••••••••"
                value={field().state.value}
                onInput={(e) => field().handleChange(e.currentTarget.value)}
                error={
                  field().state.meta.errors.length > 0 ? String(field().state.meta.errors[0]) : null
                }
                required
              />
            )}
          </form.Field>

          <Button type="submit" disabled={isSubmitting()} variant="cta" class="w-full">
            <Show when={isSubmitting()} fallback="Sign In">
              <Reload class="animate-spin" />
              <span>Signing In...</span>
            </Show>
          </Button>
        </form>
      </Card>
    </div>
  );
};

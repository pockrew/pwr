import {
  createSignal,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from "solid-js";

import { Eye, EyeOff } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import {
  TextFieldDescription,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
  TextFieldRoot,
} from "./text-field";

export interface PasswordInputProps extends Omit<ComponentProps<typeof TextFieldInput>, "type"> {
  label?: string;
  error?: string | null;
  hint?: string;
  leftAddon?: JSX.Element;
  rightAddon?: JSX.Element;
  align?: "left" | "center" | "right";
  rightAddonClass?: string;
  ref?: HTMLInputElement | ((el: HTMLInputElement) => void);
  showToggle?: boolean;
  onInput?: JSX.EventHandlerUnion<HTMLInputElement, InputEvent>;
}

export const PasswordInput: Component<PasswordInputProps> = (props) => {
  const [showPassword, setShowPassword] = createSignal(false);
  const [local, rest] = splitProps(props, [
    "class",
    "label",
    "error",
    "hint",
    "leftAddon",
    "rightAddon",
    "align",
    "disabled",
    "readOnly",
    "name",
    "rightAddonClass",
    "showToggle",
  ]);

  const hasToggle = () => local.showToggle !== false;

  return (
    <TextFieldRoot
      validationState={local.error ? "invalid" : "valid"}
      disabled={local.disabled}
      readOnly={local.readOnly}
      name={local.name}
      class="w-full"
    >
      <Show when={local.label}>
        <TextFieldLabel>{local.label}</TextFieldLabel>
      </Show>

      <div class="relative flex w-full items-center">
        <Show when={local.leftAddon}>
          <div class="text-muted-foreground z-control pointer-events-none absolute left-2.5 flex items-center">
            {local.leftAddon}
          </div>
        </Show>

        <TextFieldInput
          {...rest}
          type={showPassword() ? "text" : "password"}
          class={cn(
            local.leftAddon && "pl-8",
            (local.rightAddon || hasToggle()) && "pr-9",
            local.rightAddon && hasToggle() && "pr-16",
            local.align === "center" && "text-center",
            local.align === "right" && "text-right",
            local.class,
          )}
        />

        <div class="absolute right-2 flex items-center gap-1">
          <Show when={local.rightAddon}>
            <div
              class={cn("text-muted-foreground z-control flex items-center", local.rightAddonClass)}
            >
              {local.rightAddon}
            </div>
          </Show>

          <Show when={hasToggle()}>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword(!showPassword())}
              disabled={local.disabled}
              class={cn(
                "text-muted-foreground hover:text-foreground focus:text-foreground inline-flex size-6 cursor-pointer items-center justify-center rounded transition-colors focus:outline-none",
                local.disabled && "cursor-not-allowed opacity-50",
              )}
              title={showPassword() ? "Hide secret" : "Show secret"}
              aria-label={showPassword() ? "Hide secret" : "Show secret"}
            >
              <Show when={showPassword()} fallback={<Eye class="size-4" />}>
                <EyeOff class="size-4" />
              </Show>
            </button>
          </Show>
        </div>
      </div>

      <Show when={local.error}>
        <TextFieldErrorMessage class={cn(local.align === "center" && "text-center")}>
          {local.error}
        </TextFieldErrorMessage>
      </Show>

      <Show when={!local.error && local.hint}>
        <TextFieldDescription>{local.hint}</TextFieldDescription>
      </Show>
    </TextFieldRoot>
  );
};

export const PasswordField = PasswordInput;
export type PasswordFieldProps = PasswordInputProps;
export default PasswordInput;

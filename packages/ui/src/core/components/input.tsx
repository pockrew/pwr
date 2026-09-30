import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

import {
  TextFieldDescription,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
  TextFieldRoot,
} from "./text-field";

export interface InputProps extends ComponentProps<typeof TextFieldInput> {
  label?: string;
  error?: string | null;
  hint?: string;
  leftAddon?: JSX.Element;
  rightAddon?: JSX.Element;
  align?: "left" | "center" | "right";
  rightAddonClass?: string;
  ref?: HTMLInputElement | ((el: HTMLInputElement) => void);
  onInput?: JSX.EventHandlerUnion<HTMLInputElement, InputEvent>;
}

export const Input: Component<InputProps> = (props) => {
  const [local, rest] = splitProps(props, [
    "class",
    "style",
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
  ]);

  let leftAddonRef: HTMLDivElement | undefined;
  const [addonWidth, setAddonWidth] = createSignal<number>();

  const measureAddon = (el: HTMLDivElement | undefined) => {
    if (!el) return;
    const width = el.getBoundingClientRect().width;
    if (width > 0) {
      setAddonWidth(Math.ceil(width));
    }
  };

  createEffect(() => {
    const addon = local.leftAddon;
    if (!addon) {
      setAddonWidth(undefined);
      return;
    }

    const el = leftAddonRef;
    if (!el) return;

    measureAddon(el);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        measureAddon(el);
      });
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    }
  });

  onMount(() => {
    if (leftAddonRef) {
      measureAddon(leftAddonRef);
    }
  });

  const inputStyle = () => {
    const width = addonWidth();
    if (width === undefined) {
      return local.style;
    }
    const paddingLeft = `${width + 12}px`;
    if (typeof local.style === "string") {
      return `${local.style}; padding-left: ${paddingLeft};`;
    }
    return {
      ...(typeof local.style === "object" && local.style !== null ? local.style : {}),
      "padding-left": paddingLeft,
    };
  };

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
          <div
            ref={(el) => {
              leftAddonRef = el;
              measureAddon(el);
            }}
            class="text-muted-foreground z-control pointer-events-none absolute left-2 flex items-center"
          >
            {local.leftAddon}
          </div>
        </Show>

        <TextFieldInput
          {...rest}
          class={cn(
            local.leftAddon && addonWidth() === undefined && "pl-7",
            local.rightAddon && "pr-8",
            local.align === "center" && "text-center",
            local.align === "right" && "text-right",
            local.class,
          )}
          style={inputStyle()}
        />

        <Show when={local.rightAddon}>
          <div
            class={cn(
              "text-muted-foreground z-control absolute right-2 flex items-center",
              local.rightAddonClass,
            )}
          >
            {local.rightAddon}
          </div>
        </Show>
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

export default Input;

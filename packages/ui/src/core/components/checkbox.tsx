import * as CheckboxPrimitive from "@kobalte/core/checkbox";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { Check } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

export type CheckboxRootProps = ComponentProps<typeof CheckboxPrimitive.Root>;

export const CheckboxRoot: Component<CheckboxRootProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <CheckboxPrimitive.Root
      class={cn("group inline-flex items-center gap-2 select-none", local.class)}

      {...rest}
    >
      {local.children}
    </CheckboxPrimitive.Root>
  );
};

export type CheckboxControlProps = ComponentProps<typeof CheckboxPrimitive.Control>;

export const CheckboxControl: Component<CheckboxControlProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <>
      <CheckboxPrimitive.Input class="sr-only" />
      <CheckboxPrimitive.Control
        class={cn(
          "border-border bg-background size-4 shrink-0 rounded-md border transition-colors",
          "hover:border-foreground/50",
          "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-checked:bg-primary data-checked:text-primary-foreground data-checked:border-primary",
          "data-indeterminate:bg-primary data-indeterminate:text-primary-foreground data-indeterminate:border-primary",
          local.class,
        )}
        {...rest}
      >
        <CheckboxPrimitive.Indicator class="flex h-full w-full items-center justify-center text-current">
          {local.children ?? <Check class="size-3 stroke-[3]" />}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Control>
    </>
  );
};

export type CheckboxLabelProps = ComponentProps<typeof CheckboxPrimitive.Label>;

export const CheckboxLabel: Component<CheckboxLabelProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);

  return (
    <CheckboxPrimitive.Label
      class={cn(
        "text-foreground cursor-pointer text-xs font-medium group-disabled:cursor-not-allowed group-disabled:opacity-70",
        local.class,
      )}
      {...rest}
    />
  );
};

export const Checkbox = Object.assign(CheckboxRoot, {
  Root: CheckboxRoot,
  Control: CheckboxControl,
  Label: CheckboxLabel,
  Input: CheckboxPrimitive.Input,
  Indicator: CheckboxPrimitive.Indicator,
});

export default Checkbox;

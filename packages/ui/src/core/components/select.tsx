import {
  Content as KobalteContent,
  Description as KobalteDescription,
  ErrorMessage as KobalteErrorMessage,
  HiddenSelect as KobalteHiddenSelect,
  Icon as KobalteIcon,
  Item as KobalteItem,
  ItemIndicator as KobalteItemIndicator,
  ItemLabel as KobalteItemLabel,
  Label as KobalteLabel,
  Listbox as KobalteListbox,
  Portal as KobaltePortal,
  Root as KobalteRoot,
  Section as KobalteSection,
  Trigger as KobalteTrigger,
  Value as KobalteValue,
} from "@kobalte/core/select";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { Check, ChevronDown } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

/* -------------------------------------------------------------------------------------------------
 * SelectRoot
 * -----------------------------------------------------------------------------------------------*/

export type SelectRootProps<Option, OptGroup = never> = ComponentProps<
  typeof KobalteRoot<Option, OptGroup>
>;

export const SelectRoot = <Option, OptGroup = never>(props: SelectRootProps<Option, OptGroup>) => {
  const [local, rest] = splitProps(
    props as SelectRootProps<Option, OptGroup> & { class?: string },
    ["class"],
  );
  return (
    <KobalteRoot class={cn("flex w-full flex-col gap-1.5 font-sans", local.class)} {...rest} />
  );
};

/* -------------------------------------------------------------------------------------------------
 * SelectLabel
 * -----------------------------------------------------------------------------------------------*/

export type SelectLabelProps = ComponentProps<typeof KobalteLabel>;

export const SelectLabel: Component<SelectLabelProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteLabel
      class={cn(
        "text-foreground block text-sm font-medium select-none",
        "data-invalid:text-destructive data-disabled:opacity-50",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * SelectTrigger
 * -----------------------------------------------------------------------------------------------*/

export type SelectTriggerProps = ComponentProps<typeof KobalteTrigger>;

export const SelectTrigger: Component<SelectTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <KobalteTrigger
      class={cn(
        "bg-card border-border text-foreground flex h-9 w-full items-center justify-between rounded-full border px-3 text-sm shadow-2xs",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-invalid:border-destructive",
        local.class,
      )}
      {...rest}
    >
      {local.children}
      <KobalteIcon class="text-muted-foreground/80 size-4 shrink-0 transition-transform duration-200">
        <ChevronDown class="size-4" />
      </KobalteIcon>
    </KobalteTrigger>
  );
};

/* -------------------------------------------------------------------------------------------------
 * SelectValue
 * -----------------------------------------------------------------------------------------------*/

export type SelectValueProps<T> = ComponentProps<typeof KobalteValue<T>>;

export const SelectValue = <T,>(props: SelectValueProps<T>) => {
  const [local, rest] = splitProps(props as SelectValueProps<T> & { class?: string }, ["class"]);
  return <KobalteValue class={cn("truncate text-left text-sm", local.class)} {...rest} />;
};

/* -------------------------------------------------------------------------------------------------
 * SelectContent
 * -----------------------------------------------------------------------------------------------*/

export type SelectContentProps = ComponentProps<typeof KobalteContent>;

export const SelectContent: Component<SelectContentProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <KobaltePortal>
      <KobalteContent
        class={cn(
          "bg-popover text-popover-foreground border-border z-50 min-w-[8rem] overflow-hidden rounded-3xl border p-1 shadow-md",
          "data-expanded:animate-in data-expanded:fade-in-0 data-expanded:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          local.class,
        )}
        {...rest}
      >
        <KobalteListbox class="max-h-60 overflow-y-auto p-0 focus:outline-none" />
      </KobalteContent>
    </KobaltePortal>
  );
};

/* -------------------------------------------------------------------------------------------------
 * SelectItem
 * -----------------------------------------------------------------------------------------------*/

export type SelectItemProps = ComponentProps<typeof KobalteItem>;

export const SelectItem: Component<SelectItemProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <KobalteItem
      class={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-pointer items-center rounded-3xl py-1.5 pr-8 pl-2 text-xs outline-none select-none",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        local.class,
      )}
      {...rest}
    >
      <KobalteItemLabel class="truncate">{local.children}</KobalteItemLabel>
      <KobalteItemIndicator class="text-primary absolute right-2 flex size-3.5 items-center justify-center">
        <Check class="size-3.5" />
      </KobalteItemIndicator>
    </KobalteItem>
  );
};

/* -------------------------------------------------------------------------------------------------
 * SelectDescription & SelectErrorMessage
 * -----------------------------------------------------------------------------------------------*/

export type SelectDescriptionProps = ComponentProps<typeof KobalteDescription>;

export const SelectDescription: Component<SelectDescriptionProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteDescription class={cn("text-muted-foreground text-[11px]", local.class)} {...rest} />
  );
};

export type SelectErrorMessageProps = ComponentProps<typeof KobalteErrorMessage>;

export const SelectErrorMessage: Component<SelectErrorMessageProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <KobalteErrorMessage class={cn("text-destructive text-xs", local.class)} {...rest} />;
};

/* -------------------------------------------------------------------------------------------------
 * Compound Export
 * -----------------------------------------------------------------------------------------------*/

export const Select = Object.assign(SelectRoot, {
  Root: SelectRoot,
  Trigger: SelectTrigger,
  Value: SelectValue,
  Content: SelectContent,
  Item: SelectItem,
  ItemLabel: KobalteItemLabel,
  ItemIndicator: KobalteItemIndicator,
  Label: SelectLabel,
  Description: SelectDescription,
  ErrorMessage: SelectErrorMessage,
  HiddenSelect: KobalteHiddenSelect,
  Section: KobalteSection,
});

export default Select;

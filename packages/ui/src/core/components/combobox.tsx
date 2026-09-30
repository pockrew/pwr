import {
  Content as KobalteContent,
  Control as KobalteControl,
  Description as KobalteDescription,
  ErrorMessage as KobalteErrorMessage,
  HiddenSelect as KobalteHiddenSelect,
  Icon as KobalteIcon,
  Input as KobalteInput,
  Item as KobalteItem,
  ItemDescription as KobalteItemDescription,
  ItemIndicator as KobalteItemIndicator,
  ItemLabel as KobalteItemLabel,
  Label as KobalteLabel,
  Listbox as KobalteListbox,
  Portal as KobaltePortal,
  Root as KobalteRoot,
  Section as KobalteSection,
  Trigger as KobalteTrigger,
} from "@kobalte/core/combobox";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { Check, ChevronDown } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

/* -------------------------------------------------------------------------------------------------
 * ComboboxRoot
 * -----------------------------------------------------------------------------------------------*/

export type ComboboxRootProps<Option, OptGroup = never> = ComponentProps<
  typeof KobalteRoot<Option, OptGroup>
>;

export const ComboboxRoot = <Option, OptGroup = never>(
  props: ComboboxRootProps<Option, OptGroup>,
) => {
  const [local, rest] = splitProps(
    props as ComboboxRootProps<Option, OptGroup> & { class?: string },
    ["class"],
  );
  return (
    <KobalteRoot class={cn("flex w-full flex-col gap-1.5 font-sans", local.class)} {...rest} />
  );
};

/* -------------------------------------------------------------------------------------------------
 * ComboboxLabel
 * -----------------------------------------------------------------------------------------------*/

export type ComboboxLabelProps = ComponentProps<typeof KobalteLabel>;

export const ComboboxLabel: Component<ComboboxLabelProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteLabel
      class={cn("text-muted-foreground block text-xs font-medium select-none", local.class)}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * ComboboxControl
 * -----------------------------------------------------------------------------------------------*/

export type ComboboxControlProps<T> = ComponentProps<typeof KobalteControl<T>>;

export const ComboboxControl = <T,>(props: ComboboxControlProps<T>) => {
  const [local, rest] = splitProps(props as ComboboxControlProps<T> & { class?: string }, [
    "class",
  ]);
  return (
    <KobalteControl
      class={cn(
        "bg-card border-border relative flex h-9 w-full items-center rounded-full border shadow-2xs",
        "focus-within:ring-accent focus-within:ring-2 focus-within:outline-none",
        "data-invalid:border-destructive",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * ComboboxInput
 * -----------------------------------------------------------------------------------------------*/

export type ComboboxInputProps = ComponentProps<typeof KobalteInput>;

export const ComboboxInput: Component<ComboboxInputProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteInput
      class={cn(
        "placeholder:text-muted-foreground/60 text-foreground h-full w-full bg-transparent px-3 text-sm outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * ComboboxTrigger
 * -----------------------------------------------------------------------------------------------*/

export type ComboboxTriggerProps = ComponentProps<typeof KobalteTrigger>;

export const ComboboxTrigger: Component<ComboboxTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <KobalteTrigger
      class={cn(
        "text-muted-foreground/80 hover:text-foreground flex h-full items-center justify-center px-2.5 transition-colors",
        local.class,
      )}
      {...rest}
    >
      <KobalteIcon class="size-4 shrink-0">
        {local.children ?? <ChevronDown class="size-4" />}
      </KobalteIcon>
    </KobalteTrigger>
  );
};

/* -------------------------------------------------------------------------------------------------
 * ComboboxContent
 * -----------------------------------------------------------------------------------------------*/

export type ComboboxContentProps = ComponentProps<typeof KobalteContent>;

export const ComboboxContent: Component<ComboboxContentProps> = (props) => {
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
 * ComboboxItem
 * -----------------------------------------------------------------------------------------------*/

export type ComboboxItemProps = ComponentProps<typeof KobalteItem>;

export const ComboboxItem: Component<ComboboxItemProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <KobalteItem
      class={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-pointer items-center rounded-2xl py-1.5 pr-8 pl-2 text-xs outline-none select-none",
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
 * ComboboxDescription & ComboboxErrorMessage
 * -----------------------------------------------------------------------------------------------*/

export type ComboboxDescriptionProps = ComponentProps<typeof KobalteDescription>;

export const ComboboxDescription: Component<ComboboxDescriptionProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteDescription class={cn("text-muted-foreground text-[11px]", local.class)} {...rest} />
  );
};

export type ComboboxErrorMessageProps = ComponentProps<typeof KobalteErrorMessage>;

export const ComboboxErrorMessage: Component<ComboboxErrorMessageProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <KobalteErrorMessage class={cn("text-destructive text-xs", local.class)} {...rest} />;
};

/* -------------------------------------------------------------------------------------------------
 * Compound Export
 * -----------------------------------------------------------------------------------------------*/

export const Combobox = Object.assign(ComboboxRoot, {
  Root: ComboboxRoot,
  Control: ComboboxControl,
  Input: ComboboxInput,
  Trigger: ComboboxTrigger,
  Content: ComboboxContent,
  Item: ComboboxItem,
  ItemLabel: KobalteItemLabel,
  ItemDescription: KobalteItemDescription,
  ItemIndicator: KobalteItemIndicator,
  Label: ComboboxLabel,
  Description: ComboboxDescription,
  ErrorMessage: ComboboxErrorMessage,
  HiddenSelect: KobalteHiddenSelect,
  Section: KobalteSection,
});

export default Combobox;

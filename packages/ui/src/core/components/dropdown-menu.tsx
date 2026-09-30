import {
  Arrow as DropdownMenuArrow,
  CheckboxItem as KobalteCheckboxItem,
  Content as KobalteContent,
  Group as KobalteGroup,
  GroupLabel as KobalteGroupLabel,
  Icon as KobalteIcon,
  Item as KobalteItem,
  ItemDescription as KobalteItemDescription,
  ItemIndicator as KobalteItemIndicator,
  ItemLabel as KobalteItemLabel,
  Portal as KobaltePortal,
  RadioGroup as KobalteRadioGroup,
  RadioItem as KobalteRadioItem,
  Root as KobalteRoot,
  Separator as KobalteSeparator,
  Sub as KobalteSub,
  SubContent as KobalteSubContent,
  SubTrigger as KobalteSubTrigger,
  Trigger as KobalteTrigger,
} from "@kobalte/core/dropdown-menu";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { Check, ChevronRight } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuRoot (Root / DropdownMenu)
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuRootProps = ComponentProps<typeof KobalteRoot>;

export const DropdownMenuRoot: Component<DropdownMenuRootProps> = (props) => {
  return <KobalteRoot {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuTrigger
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuTriggerProps = ComponentProps<typeof KobalteTrigger>;

export const DropdownMenuTrigger: Component<DropdownMenuTriggerProps> = (props) => {
  return <KobalteTrigger {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuPortal
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuPortalProps = ComponentProps<typeof KobaltePortal>;

export const DropdownMenuPortal: Component<DropdownMenuPortalProps> = (props) => {
  return <KobaltePortal {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuContent
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuContentProps = ComponentProps<typeof KobalteContent>;

export const DropdownMenuContent: Component<DropdownMenuContentProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);

  return (
    <KobaltePortal>
      <KobalteContent
        class={cn(
          "bg-popover text-popover-foreground border-border z-50 min-w-32 origin-(--kb-menu-content-transform-origin) overflow-hidden rounded-lg border p-1 shadow-lg outline-none",
          "animate-in fade-in-0 zoom-in-95 duration-micro ease-default",
          "data-expanded:animate-in data-expanded:fade-in-0 data-expanded:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          local.class,
        )}
        {...rest}
      />
    </KobaltePortal>
  );
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuItem
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuItemProps = ComponentProps<typeof KobalteItem> & {
  inset?: boolean;
  destructive?: boolean;
};

export const DropdownMenuItem: Component<DropdownMenuItemProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "inset", "destructive"]);

  return (
    <KobalteItem
      class={cn(
        "duration-micro relative flex cursor-pointer items-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors outline-none select-none",
        "focus:bg-surface focus:text-foreground",
        "data-highlighted:bg-surface data-highlighted:text-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-40",
        local.inset && "pl-8",
        local.destructive &&
          "text-destructive focus:bg-destructive/10 focus:text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuGroup
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuGroupProps = ComponentProps<typeof KobalteGroup>;

export const DropdownMenuGroup: Component<DropdownMenuGroupProps> = (props) => {
  return <KobalteGroup {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuGroupLabel
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuGroupLabelProps = ComponentProps<typeof KobalteGroupLabel> & {
  inset?: boolean;
};

export const DropdownMenuGroupLabel: Component<DropdownMenuGroupLabelProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "inset"]);

  return (
    <KobalteGroupLabel
      class={cn(
        "text-muted-foreground text-meta px-2.5 py-1.5 font-medium select-none",
        local.inset && "pl-8",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuItemLabel
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuItemLabelProps = ComponentProps<typeof KobalteItemLabel>;

export const DropdownMenuItemLabel: Component<DropdownMenuItemLabelProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);

  return <KobalteItemLabel class={cn("text-xs font-medium", local.class)} {...rest} />;
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuItemDescription
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuItemDescriptionProps = ComponentProps<typeof KobalteItemDescription>;

export const DropdownMenuItemDescription: Component<DropdownMenuItemDescriptionProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);

  return (
    <KobalteItemDescription class={cn("text-muted-foreground text-meta", local.class)} {...rest} />
  );
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuSeparator
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuSeparatorProps = ComponentProps<typeof KobalteSeparator>;

export const DropdownMenuSeparator: Component<DropdownMenuSeparatorProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);

  return <KobalteSeparator class={cn("bg-border -mx-1 my-1 h-px", local.class)} {...rest} />;
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuCheckboxItem
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuCheckboxItemProps = ComponentProps<typeof KobalteCheckboxItem>;

export const DropdownMenuCheckboxItem: Component<DropdownMenuCheckboxItemProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <KobalteCheckboxItem
      class={cn(
        "duration-micro relative flex cursor-pointer items-center rounded-md py-1.5 pr-2.5 pl-8 text-xs font-medium transition-colors outline-none select-none",
        "focus:bg-surface focus:text-foreground",
        "data-highlighted:bg-surface data-highlighted:text-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-40",
        local.class,
      )}
      {...rest}
    >
      <span class="absolute left-2.5 flex size-3.5 items-center justify-center">
        <KobalteItemIndicator>
          <Check class="size-3.5" />
        </KobalteItemIndicator>
      </span>
      {local.children}
    </KobalteCheckboxItem>
  );
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuRadioGroup
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuRadioGroupProps = ComponentProps<typeof KobalteRadioGroup>;

export const DropdownMenuRadioGroup: Component<DropdownMenuRadioGroupProps> = (props) => {
  return <KobalteRadioGroup {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuRadioItem
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuRadioItemProps = ComponentProps<typeof KobalteRadioItem>;

export const DropdownMenuRadioItem: Component<DropdownMenuRadioItemProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <KobalteRadioItem
      class={cn(
        "duration-micro relative flex cursor-pointer items-center rounded-md py-1.5 pr-2.5 pl-8 text-xs font-medium transition-colors outline-none select-none",
        "focus:bg-surface focus:text-foreground",
        "data-highlighted:bg-surface data-highlighted:text-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-40",
        local.class,
      )}
      {...rest}
    >
      <span class="absolute left-2.5 flex size-3.5 items-center justify-center">
        <KobalteItemIndicator>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="size-2"
          >
            <circle cx="12" cy="12" r="6" />
          </svg>
        </KobalteItemIndicator>
      </span>
      {local.children}
    </KobalteRadioItem>
  );
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuSub & SubTrigger & SubContent
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuSubProps = ComponentProps<typeof KobalteSub>;

export const DropdownMenuSub: Component<DropdownMenuSubProps> = (props) => {
  return <KobalteSub {...props} />;
};

export type DropdownMenuSubTriggerProps = ComponentProps<typeof KobalteSubTrigger> & {
  inset?: boolean;
};

export const DropdownMenuSubTrigger: Component<DropdownMenuSubTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children", "inset"]);

  return (
    <KobalteSubTrigger
      class={cn(
        "duration-micro flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors outline-none select-none",
        "focus:bg-surface focus:text-foreground",
        "data-highlighted:bg-surface data-highlighted:text-foreground",
        "data-expanded:bg-surface data-expanded:text-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-40",
        local.inset && "pl-8",
        local.class,
      )}
      {...rest}
    >
      {local.children}
      <ChevronRight class="text-muted-foreground ml-auto size-3.5" />
    </KobalteSubTrigger>
  );
};

export type DropdownMenuSubContentProps = ComponentProps<typeof KobalteSubContent>;

export const DropdownMenuSubContent: Component<DropdownMenuSubContentProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);

  return (
    <KobalteSubContent
      class={cn(
        "bg-popover text-popover-foreground border-border z-50 min-w-32 origin-(--kb-menu-content-transform-origin) overflow-hidden rounded-lg border p-1 shadow-lg outline-none",
        "animate-in fade-in-0 zoom-in-95 duration-micro ease-default",
        "data-expanded:animate-in data-expanded:fade-in-0 data-expanded:zoom-in-95",
        "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * DropdownMenuItemIndicator & DropdownMenuIcon & DropdownMenuArrow
 * -----------------------------------------------------------------------------------------------*/

export type DropdownMenuItemIndicatorProps = ComponentProps<typeof KobalteItemIndicator>;

export const DropdownMenuItemIndicator: Component<DropdownMenuItemIndicatorProps> = (props) => {
  return <KobalteItemIndicator {...props} />;
};

export type DropdownMenuIconProps = ComponentProps<typeof KobalteIcon>;

export const DropdownMenuIcon: Component<DropdownMenuIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteIcon class={cn("text-muted-foreground ml-auto size-3.5", local.class)} {...rest} />
  );
};

export type DropdownMenuShortcutProps = ComponentProps<"span">;

export const DropdownMenuShortcut: Component<DropdownMenuShortcutProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <span
      class={cn("text-muted-foreground ml-auto font-mono text-[10px] tracking-widest", local.class)}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * Compound Export
 * -----------------------------------------------------------------------------------------------*/

export const DropdownMenu = Object.assign(DropdownMenuRoot, {
  Root: DropdownMenuRoot,
  Trigger: DropdownMenuTrigger,
  Portal: DropdownMenuPortal,
  Content: DropdownMenuContent,
  Item: DropdownMenuItem,
  Group: DropdownMenuGroup,
  GroupLabel: DropdownMenuGroupLabel,
  ItemLabel: DropdownMenuItemLabel,
  ItemDescription: DropdownMenuItemDescription,
  Separator: DropdownMenuSeparator,
  CheckboxItem: DropdownMenuCheckboxItem,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  ItemIndicator: DropdownMenuItemIndicator,
  Icon: DropdownMenuIcon,
  Arrow: DropdownMenuArrow,
  Shortcut: DropdownMenuShortcut,
});

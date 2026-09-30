import {
  Content as KobalteContent,
  Indicator as KobalteIndicator,
  List as KobalteList,
  Root as KobalteRoot,
  Trigger as KobalteTrigger,
} from "@kobalte/core/tabs";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

export type TabsRootProps = ComponentProps<typeof KobalteRoot>;

export const TabsRoot: Component<TabsRootProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <KobalteRoot class={cn("flex w-full flex-col font-sans", local.class)} {...rest} />;
};

/* -------------------------------------------------------------------------------------------------
 * TabsList
 * -----------------------------------------------------------------------------------------------*/

export type TabsListProps = ComponentProps<typeof KobalteList>;

export const TabsList: Component<TabsListProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <KobalteList
      class={cn("border-border relative flex items-center gap-1", local.class)}
      {...rest}
    >
      {local.children}
      <TabsIndicator />
    </KobalteList>
  );
};

/* -------------------------------------------------------------------------------------------------
 * TabsTrigger
 * -----------------------------------------------------------------------------------------------*/

export type TabsTriggerProps = ComponentProps<typeof KobalteTrigger>;

export const TabsTrigger: Component<TabsTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteTrigger
      class={cn(
        "relative inline-flex items-center justify-center whitespace-nowrap",
        "h-9 px-2",
        "text-muted-foreground cursor-pointer text-sm font-medium select-none",
        "rounded-md",
        "duration-micro ease-default transition-all",
        "hover:text-foreground",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        "data-selected:text-foreground data-selected:font-semibold",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * TabsIndicator
 * -----------------------------------------------------------------------------------------------*/

export type TabsIndicatorProps = ComponentProps<typeof KobalteIndicator>;

export const TabsIndicator: Component<TabsIndicatorProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteIndicator
      class={cn(
        "z-base bg-primary duration-component ease-default pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full transition-all motion-reduce:transition-none",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * TabsContent
 * -----------------------------------------------------------------------------------------------*/

export type TabsContentProps = ComponentProps<typeof KobalteContent>;

export const TabsContent: Component<TabsContentProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteContent
      class={cn("focus-visible:ring-accent outline-none focus-visible:ring-2", local.class)}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * Compound Export
 * -----------------------------------------------------------------------------------------------*/

export const Tabs = Object.assign(TabsRoot, {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
  Indicator: TabsIndicator,
});

export default Tabs;

import {
  CloseButton as KobalteCloseButton,
  Content as KobalteContent,
  Description as KobalteDescription,
  Overlay as KobalteOverlay,
  Portal as KobaltePortal,
  Root as KobalteRoot,
  Title as KobalteTitle,
  Trigger as KobalteTrigger,
} from "@kobalte/core/dialog";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { Close } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import Button from "./button";

/* -------------------------------------------------------------------------------------------------
 * SheetRoot
 * -----------------------------------------------------------------------------------------------*/

export type SheetRootProps = ComponentProps<typeof KobalteRoot>;

export const SheetRoot: Component<SheetRootProps> = (props) => {
  return <KobalteRoot {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * SheetTrigger
 * -----------------------------------------------------------------------------------------------*/

export type SheetTriggerProps = ComponentProps<typeof KobalteTrigger>;

export const SheetTrigger: Component<SheetTriggerProps> = (props) => {
  return <KobalteTrigger {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * SheetPortal
 * -----------------------------------------------------------------------------------------------*/

export type SheetPortalProps = ComponentProps<typeof KobaltePortal>;

export const SheetPortal: Component<SheetPortalProps> = (props) => {
  return <KobaltePortal {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * SheetOverlay
 * -----------------------------------------------------------------------------------------------*/

export type SheetOverlayProps = ComponentProps<typeof KobalteOverlay>;

export const SheetOverlay: Component<SheetOverlayProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteOverlay
      class={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-xs",
        "data-expanded:animate-in data-expanded:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * SheetContent
 * -----------------------------------------------------------------------------------------------*/

export type SheetSide = "top" | "bottom" | "left" | "right" | "center";

export type SheetContentProps = ComponentProps<typeof KobalteContent> & {
  side?: SheetSide;
  hideCloseButton?: boolean;
};

const sheetVariants: Record<SheetSide, string> = {
  top: "inset-x-0 top-0 border-b data-expanded:slide-in-from-top data-closed:slide-out-to-top",
  bottom:
    "inset-x-0 bottom-0 border-t data-expanded:slide-in-from-bottom data-closed:slide-out-to-bottom",
  left: "inset-y-0 left-0 h-full w-full max-w-md border-r data-expanded:slide-in-from-left data-closed:slide-out-to-left",
  right:
    "inset-y-0 right-0 h-full w-full max-w-md border-l data-expanded:slide-in-from-right data-closed:slide-out-to-right",
  center:
    "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] rounded-2xl border overflow-y-auto data-expanded:fade-in-0 data-expanded:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95",
};

export const SheetContent: Component<SheetContentProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children", "side", "hideCloseButton"]);
  const side = () => local.side ?? "right";

  return (
    <SheetPortal>
      <SheetOverlay />
      <KobalteContent
        class={cn(
          "bg-background text-foreground border-border fixed z-50 flex flex-col shadow-2xl transition duration-200 ease-in-out",
          "data-expanded:animate-in data-closed:animate-out",
          sheetVariants[side()],
          local.class,
        )}
        {...rest}
      >
        {local.children}
        {!local.hideCloseButton && (
          <KobalteCloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            class={cn("absolute", side() === "center" ? "top-2.5 right-2.5" : "top-1.5 right-1")}
          >
            <Close />
          </KobalteCloseButton>
        )}
      </KobalteContent>
    </SheetPortal>
  );
};

/* -------------------------------------------------------------------------------------------------
 * SheetHeader
 * -----------------------------------------------------------------------------------------------*/

export type SheetHeaderProps = ComponentProps<"div">;

export const SheetHeader: Component<SheetHeaderProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("border-border flex shrink-0 flex-col gap-1.5 border-b px-4 py-3", local.class)}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * SheetFooter
 * -----------------------------------------------------------------------------------------------*/

export type SheetFooterProps = ComponentProps<"div">;

export const SheetFooter: Component<SheetFooterProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "border-border flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * SheetTitle
 * -----------------------------------------------------------------------------------------------*/

export type SheetTitleProps = ComponentProps<typeof KobalteTitle>;

export const SheetTitle: Component<SheetTitleProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteTitle
      class={cn("text-foreground text-lg font-semibold tracking-tight", local.class)}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * SheetDescription
 * -----------------------------------------------------------------------------------------------*/

export type SheetDescriptionProps = ComponentProps<typeof KobalteDescription>;

export const SheetDescription: Component<SheetDescriptionProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <KobalteDescription class={cn("text-muted-foreground text-sm", local.class)} {...rest} />;
};

/* -------------------------------------------------------------------------------------------------
 * SheetClose
 * -----------------------------------------------------------------------------------------------*/

export type SheetCloseProps = ComponentProps<typeof KobalteCloseButton>;

export const SheetClose: Component<SheetCloseProps> = (props) => {
  return <KobalteCloseButton {...props} />;
};

/* -------------------------------------------------------------------------------------------------
 * Compound Export
 * -----------------------------------------------------------------------------------------------*/

export const Sheet = Object.assign(SheetRoot, {
  Root: SheetRoot,
  Trigger: SheetTrigger,
  Portal: SheetPortal,
  Overlay: SheetOverlay,
  Content: SheetContent,
  Header: SheetHeader,
  Title: SheetTitle,
  Description: SheetDescription,
  Footer: SheetFooter,
  Close: SheetClose,
});

/* -------------------------------------------------------------------------------------------------
 * Dialog (Sheet centered variant wrapper)
 * -----------------------------------------------------------------------------------------------*/

export type DialogContentProps = SheetContentProps;
export type DialogRootProps = SheetRootProps;
export type DialogTriggerProps = SheetTriggerProps;
export type DialogHeaderProps = SheetHeaderProps;
export type DialogFooterProps = SheetFooterProps;
export type DialogTitleProps = SheetTitleProps;
export type DialogDescriptionProps = SheetDescriptionProps;
export type DialogCloseProps = SheetCloseProps;

export const DialogContent: Component<DialogContentProps> = (props) => {
  const [local, rest] = splitProps(props, ["side"]);
  return <SheetContent side={local.side ?? "center"} {...rest} />;
};

export const Dialog = Object.assign(SheetRoot, {
  Root: SheetRoot,
  Trigger: SheetTrigger,
  Portal: SheetPortal,
  Overlay: SheetOverlay,
  Content: DialogContent,
  Header: SheetHeader,
  Title: SheetTitle,
  Description: SheetDescription,
  Footer: SheetFooter,
  Close: SheetClose,
});

export default Sheet;

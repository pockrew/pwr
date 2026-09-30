import { splitProps, type Component, type ComponentProps } from "solid-js";
import { Toaster as SonnerToaster, toast } from "solid-sonner";

import { cn } from "@pockrew/pwr-ui/libs";

export type ToasterProps = ComponentProps<typeof SonnerToaster>;

export const Toaster: Component<ToasterProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "toastOptions", "position", "expand"]);

  return (
    <SonnerToaster
      position={local.position || "top-right"}
      expand={local.expand ?? true}
      class={cn("toaster group z-toast", local.class)}
      toastOptions={{
        classes: {
          toast:
            "group toast group-[.toaster]:!bg-card group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:!border-border group-[.toaster]:shadow-xl group-[.toaster]:rounded-card group-[.toaster]:px-4 group-[.toaster]:py-3 font-sans font-medium text-xs sm:text-sm !h-auto",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-xs font-normal",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:font-semibold group-[.toast]:rounded-component group-[.toast]:text-xs group-[.toast]:px-3 group-[.toast]:py-1.5",
          cancelButton:
            "group-[.toast]:bg-surface group-[.toast]:text-foreground group-[.toast]:rounded-component group-[.toast]:text-xs group-[.toast]:px-3 group-[.toast]:py-1.5",
          closeButton:
            "group-[.toast]:bg-card group-[.toast]:text-muted-foreground group-[.toast]:hover:text-foreground group-[.toast]:border-border",
          error: "group-[.toaster]:!text-destructive",
          success: "group-[.toaster]:!text-emerald-600 dark:group-[.toaster]:!text-emerald-400",
          warning: "group-[.toaster]:!text-amber-600 dark:group-[.toaster]:!text-amber-400",
          info: "group-[.toaster]:!text-blue-600 dark:group-[.toaster]:!text-blue-400",
        },
        ...local.toastOptions,
      }}
      {...rest}
    />
  );
};

export const ToasterProvider = Toaster;
export { toast };
export default Toaster;

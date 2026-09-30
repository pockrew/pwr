import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

export const badgeVariants = cva(
  "inline-flex items-center rounded-md font-mono font-medium transition-colors select-none",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary border border-primary/20",
        secondary: "bg-secondary text-secondary-foreground border border-border",
        destructive: "bg-destructive/10 text-destructive border border-destructive/20",
        success:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
        warning: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/25",
        info: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-500/20",
        outline: "text-foreground border border-border bg-transparent",
        ghost: "text-muted-foreground border-none bg-transparent",
      },
      size: {
        sm: "px-1.5 py-0.5 text-[10px] leading-tight",
        md: "px-2 py-0.5 text-xs leading-normal",
        lg: "px-2.5 py-1 text-sm leading-normal",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export const Badge: Component<BadgeProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "variant", "size"]);

  return (
    <span
      class={cn(badgeVariants({ variant: local.variant, size: local.size }), local.class)}
      {...rest}
    />
  );
};

export default Badge;

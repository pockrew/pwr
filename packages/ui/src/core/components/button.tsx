import { Button as KobalteButton } from "@kobalte/core/button";
import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors duration-micro ease-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] rounded-full shadow-xs",
        cta: "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] rounded-full shadow-xs font-semibold",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98] rounded-full",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground text-foreground active:scale-[0.98] rounded-md",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98] rounded-md",
        ghost:
          "hover:bg-accent hover:text-accent-foreground text-muted-foreground hover:text-foreground active:scale-[0.98] rounded-md",
        link: "text-primary underline-offset-4 hover:underline",
        editorial:
          "bg-background text-foreground font-sans font-medium border border-border-strong hover:bg-accent active:scale-[0.98] rounded-md",
      },
      size: {
        xs: "h-6 px-2.5 text-xs",
        sm: "h-8 px-3.5 text-xs",
        default: "h-9 px-4 text-sm",
        lg: "h-10 px-5 text-base",
        "icon-lg": "size-11 shrink-0 rounded-md",
        icon: "size-8 shrink-0 rounded-md",
        "icon-xs": "size-6 shrink-0 rounded-md",
        "icon-sm": "size-7 shrink-0 rounded-md",
      },
      pill: {
        true: "rounded-full!",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ComponentProps<typeof KobalteButton> &
  VariantProps<typeof buttonVariants>;

export const Button: Component<ButtonProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "variant", "size", "pill"]);

  return (
    <KobalteButton
      class={cn(
        buttonVariants({ variant: local.variant, size: local.size, pill: local.pill }),
        local.class,
      )}
      {...rest}
    />
  );
};

export default Button;

import { mergeProps, splitProps, type Component, type ComponentProps } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

type CardRadius = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl";

type Props = ComponentProps<"div"> & {
  radius?: CardRadius;
};

const radiusClass: Record<CardRadius, string> = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
  "4xl": "rounded-4xl",
};

export const Card: Component<Props> = (raw) => {
  const props = mergeProps({ radius: "2xl" as CardRadius }, raw);
  const [local, rest] = splitProps(props, ["radius", "class"]);

  return (
    <div
      class={cn(
        radiusClass[local.radius],
        "border-border bg-background text-foreground border",
        local.class,
      )}
      {...rest}
    />
  );
};

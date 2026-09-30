import { mergeProps, splitProps, type ParentComponent } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

export type IconSize = "sm" | "md" | "lg";

export type IconProps = {
  size?: IconSize;
  class?: string;
};

const sizeClasses: Record<IconSize, string> = {
  sm: "w-4 h-4 text-sm",
  md: "w-5 h-5 text-base",
  lg: "w-6 h-6 text-lg",
};

export const IconBase: ParentComponent<IconProps> = (rawProps) => {
  const props = mergeProps({ size: "md" as IconSize }, rawProps);
  const [local, rest] = splitProps(props, ["size", "class"]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cn("shrink-0", sizeClasses[local.size], local.class)}
    >
      {rest.children}
    </svg>
  );
};

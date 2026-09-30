import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Activity: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M22 12H18L15 21L9 3L6 12H2" />
  </IconBase>
);

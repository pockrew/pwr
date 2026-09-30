import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Close: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M18 6L6.00081 17.9992M17.9992 18L6 6.00085" />
  </IconBase>
);

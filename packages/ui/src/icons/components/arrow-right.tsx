import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const ArrowRight: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </IconBase>
);

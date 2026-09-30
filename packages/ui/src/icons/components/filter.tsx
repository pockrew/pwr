import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Filter: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M3 5H21" />
    <path d="M6 12H18" />
    <path d="M10 19H14" />
  </IconBase>
);

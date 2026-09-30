import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Hambuger: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M4 5H20" />
    <path d="M4 12H20" />
    <path d="M4 19H20" />
  </IconBase>
);

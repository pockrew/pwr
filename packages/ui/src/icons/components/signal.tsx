import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Signal: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M2 20H4M7 20H9V14H7V20ZM12 20H14V9H12V20ZM17 20H19V4H17V20Z" />
  </IconBase>
);

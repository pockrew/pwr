import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const ChevronDown: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9" />
  </IconBase>
);

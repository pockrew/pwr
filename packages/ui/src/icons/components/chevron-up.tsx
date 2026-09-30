import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const ChevronUp: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M6 9.00005C6 9.00005 10.4188 3 12 3C13.5812 3 18 9 18 9" />
  </IconBase>
);

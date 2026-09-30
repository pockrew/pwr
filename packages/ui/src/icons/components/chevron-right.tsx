import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const ChevronRight: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M9 18l6-6-6-6" />
  </IconBase>
);

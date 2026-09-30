import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Zap: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M13.5 2L4 13.5H12L10.5 22L20 10.5H12L13.5 2Z" />
  </IconBase>
);

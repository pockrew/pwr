import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const InfoCircle: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8V8.01" />
    <path d="M12 11V16" />
  </IconBase>
);

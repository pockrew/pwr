import { type Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const ArrowLeft: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </IconBase>
);

import { type Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Check: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <polyline points="20 6 9 17 4 12" />
  </IconBase>
);

import { splitProps, type Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Pause: Component<IconProps> = (props) => {
  const [local, rest] = splitProps(props, ["size", "class"]);
  return (
    <IconBase {...local} {...rest}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </IconBase>
  );
};

import { splitProps, type Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Play: Component<IconProps> = (props) => {
  const [local, rest] = splitProps(props, ["size", "class"]);
  return (
    <IconBase {...local} {...rest}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </IconBase>
  );
};

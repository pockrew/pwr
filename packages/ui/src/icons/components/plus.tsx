import { splitProps, type Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Plus: Component<IconProps> = (props) => {
  const [local, rest] = splitProps(props, ["size", "class"]);
  return (
    <IconBase {...local} {...rest}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </IconBase>
  );
};

import { splitProps, type Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const Lock: Component<IconProps> = (props) => {
  const [local, rest] = splitProps(props, ["size", "class"]);
  return (
    <IconBase {...local} {...rest}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </IconBase>
  );
};

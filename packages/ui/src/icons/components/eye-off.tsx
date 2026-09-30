import { splitProps, type Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const EyeOff: Component<IconProps> = (props) => {
  const [local, rest] = splitProps(props, ["size", "class"]);
  return (
    <IconBase {...local} {...rest}>
      <path d="m2 2 20 20" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639a10.468 10.468 0 0 1-4.148 4.793" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2.036 11.683a1.012 1.012 0 0 0 0 .639C3.423 16.49 7.36 19.5 12 19.5c1.788 0 3.447-.45 4.88-1.24" />
    </IconBase>
  );
};

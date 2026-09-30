import type { Component } from "solid-js";

import { IconBase, type IconProps } from "./icon-base";

export const NetworkDisconnected: Component<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M14.5002 15L9.50016 20M14.5002 20L9.50016 15"></path>
    <path d="M18.5 13C14.7324 9 9.5 9 5.5 13" stroke-linejoin="round"></path>
    <path d="M2 8C8.31579 2.66669 15.6842 2.66668 22 7.99989" stroke-linejoin="round"></path>
  </IconBase>
);

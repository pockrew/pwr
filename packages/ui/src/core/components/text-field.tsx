import {
  Description as KobalteDescription,
  ErrorMessage as KobalteErrorMessage,
  Input as KobalteInput,
  Label as KobalteLabel,
  Root as KobalteRoot,
  TextArea as KobalteTextArea,
} from "@kobalte/core/text-field";
import { splitProps, type Component, type ComponentProps } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

export type TextFieldRootProps = ComponentProps<typeof KobalteRoot>;

export const TextFieldRoot: Component<TextFieldRootProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteRoot
      class={cn("flex w-full flex-col space-y-1.5 text-left font-sans", local.class)}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * TextFieldLabel
 * -----------------------------------------------------------------------------------------------*/

export type TextFieldLabelProps = ComponentProps<typeof KobalteLabel>;

export const TextFieldLabel: Component<TextFieldLabelProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteLabel
      class={cn(
        "text-foreground block text-sm font-medium select-none",
        "data-invalid:text-destructive data-disabled:opacity-50",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * TextFieldInput
 * iOS Auto-Zoom Rule (§18.3): Font-size is text-base (16px) or text-sm (14px).
 * -----------------------------------------------------------------------------------------------*/

export type TextFieldInputProps = ComponentProps<typeof KobalteInput>;

export const TextFieldInput: Component<TextFieldInputProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteInput
      class={cn(
        "bg-background border-input w-full rounded-full border px-3 py-1.5",
        "text-foreground placeholder:text-muted-foreground text-sm",
        "h-9",
        "duration-micro transition-colors",
        "focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "data-invalid:border-destructive data-invalid:text-destructive data-invalid:focus-visible:ring-destructive",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * TextFieldTextArea
 * -----------------------------------------------------------------------------------------------*/

export type TextFieldTextAreaProps = ComponentProps<typeof KobalteTextArea>;

export const TextFieldTextArea: Component<TextFieldTextAreaProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteTextArea
      class={cn(
        "bg-background border-input w-full rounded-md border px-3 py-2",
        "text-foreground placeholder:text-muted-foreground text-sm",
        "min-h-20",
        "duration-micro transition-colors",
        "focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "data-invalid:border-destructive data-invalid:text-destructive data-invalid:focus-visible:ring-destructive",
        local.class,
      )}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * TextFieldDescription
 * -----------------------------------------------------------------------------------------------*/

export type TextFieldDescriptionProps = ComponentProps<typeof KobalteDescription>;

export const TextFieldDescription: Component<TextFieldDescriptionProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <KobalteDescription class={cn("text-muted-foreground text-sm", local.class)} {...rest} />;
};

/* -------------------------------------------------------------------------------------------------
 * TextFieldErrorMessage
 * -----------------------------------------------------------------------------------------------*/

export type TextFieldErrorMessageProps = ComponentProps<typeof KobalteErrorMessage>;

export const TextFieldErrorMessage: Component<TextFieldErrorMessageProps> = (props) => {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KobalteErrorMessage
      class={cn("text-destructive text-xs font-medium", local.class)}
      {...rest}
    />
  );
};

/* -------------------------------------------------------------------------------------------------
 * Compound Export
 * -----------------------------------------------------------------------------------------------*/

export const TextField = Object.assign(TextFieldRoot, {
  Root: TextFieldRoot,
  Label: TextFieldLabel,
  Input: TextFieldInput,
  TextArea: TextFieldTextArea,
  Description: TextFieldDescription,
  ErrorMessage: TextFieldErrorMessage,
});

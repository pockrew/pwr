import { createMemo, splitProps, type Component, type ComponentProps } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

/* -------------------------------------------------------------------------------------------------
 * OS & Keyboard Modifier Detection Helpers
 * -----------------------------------------------------------------------------------------------*/

export type OperatingSystem = "mac" | "windows" | "linux" | "other";

/**
 * Detect the current operating system across browser and SSR environments.
 */
export const getOperatingSystem = (): OperatingSystem => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "mac";
  }

  // 1. User-Agent Client Hints (modern Chromium/Edge)
  const navAny = navigator as unknown as { userAgentData?: { platform?: string } };
  if (navAny.userAgentData?.platform) {
    const platform = navAny.userAgentData.platform.toLowerCase();
    if (platform.includes("mac")) return "mac";
    if (platform.includes("win")) return "windows";
    if (platform.includes("linux")) return "linux";
  }

  // 2. Fallback: platform and userAgent string inspection
  const platform = (navigator.platform || "").toLowerCase();
  const userAgent = (navigator.userAgent || "").toLowerCase();

  if (platform.includes("mac") || userAgent.includes("macintosh") || userAgent.includes("mac os")) {
    return "mac";
  }
  if (platform.includes("win") || userAgent.includes("windows")) {
    return "windows";
  }
  if (platform.includes("linux") || userAgent.includes("linux") || userAgent.includes("x11")) {
    return "linux";
  }

  return "other";
};

/** Check if client OS is macOS */
export const isMac = () => getOperatingSystem() === "mac";

/** Check if client OS is Windows */
export const isWindows = () => getOperatingSystem() === "windows";

/** Check if client OS is Linux */
export const isLinux = () => getOperatingSystem() === "linux";

/**
 * Returns primary modifier key symbol for the current OS.
 * macOS: "⌘"
 * Windows / Linux / Other: "Ctrl"
 */
export const getModifierKey = () => (isMac() ? "⌘" : "Ctrl");

/**
 * Returns primary modifier key full name for current OS.
 * macOS: "Cmd"
 * Windows / Linux / Other: "Ctrl"
 */
export const getModifierName = () => (isMac() ? "Cmd" : "Ctrl");

/**
 * Returns Alt / Option key symbol for current OS.
 * macOS: "⌥"
 * Windows / Linux / Other: "Alt"
 */
export const getAltKey = () => (isMac() ? "⌥" : "Alt");

/**
 * Returns Shift key symbol for current OS.
 * macOS: "⇧"
 * Windows / Linux / Other: "Shift"
 */
export const getShiftKey = () => (isMac() ? "⇧" : "Shift");

/**
 * Returns Control key symbol for current OS.
 * macOS: "⌃"
 * Windows / Linux / Other: "Ctrl"
 */
export const getControlKey = () => (isMac() ? "⌃" : "Ctrl");

/**
 * Checks if any modal, sheet, dialog, dropdown menu, select, combobox, or popover overlay is currently open in the DOM.
 */
export const isOverlayOpen = (): boolean => {
  if (typeof document === "undefined") return false;

  const selector = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="menu"]',
    '[role="listbox"]',
    "[data-kb-dialog-content]",
    "[data-kb-dialog-overlay]",
    "[data-kb-menu-content]",
    "[data-kb-dropdown-menu-content]",
    "[data-kb-select-content]",
    "[data-kb-combobox-content]",
    "[data-kb-popover-content]",
    '[data-state="open"][data-kb-dialog]',
    '[data-state="open"][data-kb-menu]',
    '[aria-modal="true"]',
    "dialog[open]",
  ].join(", ");

  const openOverlay = document.querySelector(selector);
  return Boolean(openOverlay);
};

/**
 * Checks if an interactive text-editing input element is currently focused.
 */
export const isInputFocused = (): boolean => {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active) return false;

  const tag = active.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  if (
    active.getAttribute("contenteditable") === "true" ||
    (active as HTMLElement).isContentEditable
  ) {
    return true;
  }

  return false;
};

/**
 * Determines whether background keyboard shortcut handlers should be suppressed.
 * Background shortcuts should be ignored when:
 * 1. User is typing in an input/textarea/editable field.
 * 2. Any sheet, modal, dialog, dropdown menu, select listbox, or popover is currently open.
 */
export const isKeyboardBlocked = (): boolean => {
  return isInputFocused() || isOverlayOpen();
};

/**
 * Formats a key combination string dynamically according to the host OS.
 *
 * Examples:
 * - "⌘K" or "Mod+K" -> "⌘K" (Mac) vs "Ctrl+K" (Win/Linux)
 * - "⌘1" or "Mod+1" -> "⌘1" (Mac) vs "Ctrl+1" (Win/Linux)
 * - "⌘B" or "Mod+B" -> "⌘B" (Mac) vs "Ctrl+B" (Win/Linux)
 * - "⌘F" or "Mod+F" -> "⌘F" (Mac) vs "Ctrl+F" (Win/Linux)
 * - "^C" or "Ctrl+C" -> "^C" (Mac) vs "Ctrl+C" (Win/Linux)
 * - "Alt+N" -> "⌥N" (Mac) vs "Alt+N" (Win/Linux)
 */
export const formatShortcut = (shortcut: string) => {
  if (!shortcut || typeof shortcut !== "string") return shortcut;

  const mac = isMac();

  if (mac) {
    return shortcut
      .replace(/\bmod\b/gi, "⌘")
      .replace(/\bcmd\b/gi, "⌘")
      .replace(/\bcommand\b/gi, "⌘")
      .replace(/\bctrl\b/gi, "⌃")
      .replace(/\bcontrol\b/gi, "⌃")
      .replace(/\balt\b/gi, "⌥")
      .replace(/\bopt\b/gi, "⌥")
      .replace(/\boption\b/gi, "⌥")
      .replace(/\bshift\b/gi, "⇧");
  }

  // Windows / Linux / Others
  return shortcut
    .replace(/⌘/g, "Ctrl+")
    .replace(/⌃/g, "Ctrl+")
    .replace(/⌥/g, "Alt+")
    .replace(/⇧/g, "Shift+")
    .replace(/\bmod\b/gi, "Ctrl")
    .replace(/\bcmd\b/gi, "Ctrl")
    .replace(/\bcommand\b/gi, "Ctrl")
    .replace(/\bopt\b/gi, "Alt")
    .replace(/\boption\b/gi, "Alt")
    .replace(/\^C/g, "Ctrl+C");
};

/* -------------------------------------------------------------------------------------------------
 * Kbd (Keyboard Key Binding Badge)
 * -----------------------------------------------------------------------------------------------*/

export type KbdProps = ComponentProps<"kbd"> & {
  size?: "sm" | "default" | "lg";
  /**
   * If true (default), automatically formats modifier key strings (⌘, mod, cmd, etc.)
   * to match the user's active OS (e.g. ⌘ on macOS, Ctrl+ on Windows/Linux).
   */
  autoFormat?: boolean;
};

const sizeVariants = {
  sm: "h-4 min-w-4 px-1 text-[9px]",
  default: "h-5 min-w-5 px-1.5 text-[10px]",
  lg: "h-6 min-w-6 px-2 text-xs",
};

export const Kbd: Component<KbdProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "size", "autoFormat", "children"]);
  const size = () => local.size ?? "default";
  const autoFormat = () => local.autoFormat ?? true;

  const formattedChildren = createMemo(() => {
    if (autoFormat() && typeof local.children === "string") {
      return formatShortcut(local.children);
    }
    return local.children;
  });

  return (
    <kbd
      class={cn(
        "bg-muted/80 text-muted-foreground border-border/80 inline-flex items-center justify-center font-mono font-medium select-none",
        "rounded border shadow-2xs transition-colors",
        sizeVariants[size()],
        local.class,
      )}
      {...rest}
    >
      {formattedChildren()}
    </kbd>
  );
};

/* -------------------------------------------------------------------------------------------------
 * KbdGroup (Multiple key bindings in a row e.g. ⌘ + K)
 * -----------------------------------------------------------------------------------------------*/

export type KbdGroupProps = ComponentProps<"div">;

export const KbdGroup: Component<KbdGroupProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <div class={cn("inline-flex items-center gap-0.5", local.class)} {...rest}>
      {local.children}
    </div>
  );
};

export default Kbd;

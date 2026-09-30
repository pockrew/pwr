import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { Compartment, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";
import { createEffect, onCleanup, onMount, type Component } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

import {
  formatHexDump,
  formatXml,
  PayloadFormatEnum,
  type PayloadFormat,
} from "~/libs/content-type";

export interface CodeViewerProps {
  value?: string | null;
  class?: string;
  language?: PayloadFormat | "json" | "text" | "xml" | "html" | "hex" | "form";
  readOnly?: boolean;
}

const customTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    backgroundColor: "transparent !important",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "inherit",
  },
  ".cm-gutters": {
    backgroundColor: "transparent !important",
    color: "var(--color-muted-foreground)",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

/**
 * Resolves the appropriate CodeMirror language extension for the target syntax mode.
 *
 * @param lang - Target language or payload format identifier
 * @returns CodeMirror language extension
 */
const getLanguageExtension = (lang?: string): Extension => {
  switch (lang) {
    case PayloadFormatEnum.JSON:
    case "json":
      return json();
    case PayloadFormatEnum.XML:
    case "xml":
      return xml();
    case PayloadFormatEnum.HTML:
    case "html":
      return html();
    default:
      return [];
  }
};

/**
 * Formats a text payload according to its language or format type.
 *
 * @param val - Raw payload string
 * @param lang - Target format or language
 * @returns Formatted string for CodeMirror editor display
 */
const formatCodeContent = (val?: string | null, lang?: string): string => {
  // 1. Guard against empty payload
  if (!val) return "";
  const targetLang = lang ?? PayloadFormatEnum.JSON;

  // 2. Format based on syntax type
  switch (targetLang) {
    case PayloadFormatEnum.HEX:
      return formatHexDump(val);

    case PayloadFormatEnum.XML:
    case PayloadFormatEnum.HTML:
      return formatXml(val);

    case PayloadFormatEnum.TEXT:
    case PayloadFormatEnum.FORM:
    case PayloadFormatEnum.MULTIPART:
      return val;

    case PayloadFormatEnum.JSON:
    default:
      try {
        const parsed = JSON.parse(val);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return val;
      }
  }
};

/**
 * Read-only or editable CodeMirror 6 code viewer component with auto-theming and dynamic syntax switching.
 */
export const CodeViewer: Component<CodeViewerProps> = (props) => {
  let containerRef!: HTMLDivElement;
  let view: EditorView | undefined;
  const langCompartment = new Compartment();

  onMount(() => {
    // 1. Guard against missing DOM container
    if (!containerRef) return;

    // 2. Determine initial environment settings
    const isDark = document.documentElement.classList.contains("dark");
    const lang = props.language ?? PayloadFormatEnum.JSON;

    // 3. Initialize CodeMirror extensions
    const extensions = [
      basicSetup,
      customTheme,
      EditorView.lineWrapping,
      EditorView.editable.of(!props.readOnly),
      langCompartment.of(getLanguageExtension(lang)),
      isDark ? oneDark : [],
    ];

    // 4. Create EditorView instance
    view = new EditorView({
      doc: formatCodeContent(props.value, props.language),
      extensions,
      parent: containerRef,
    });

    // 5. Reactively update editor content and language compartment when props change
    createEffect(() => {
      const currentLang = props.language ?? PayloadFormatEnum.JSON;
      const formatted = formatCodeContent(props.value, props.language);
      if (view) {
        const changes =
          formatted !== view.state.doc.toString()
            ? { from: 0, to: view.state.doc.length, insert: formatted }
            : undefined;

        view.dispatch({
          ...(changes ? { changes } : {}),
          effects: langCompartment.reconfigure(getLanguageExtension(currentLang)),
        });
      }
    });

    // 6. Cleanup editor on unmount
    onCleanup(() => {
      view?.destroy();
    });
  });

  return (
    <div
      ref={(el) => {
        containerRef = el;
      }}
      class={cn("bg-card h-full overflow-hidden text-left font-mono", props.class)}
    />
  );
};

export default CodeViewer;

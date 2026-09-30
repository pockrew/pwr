import { createMemo, createSignal, For, Show, type Component } from "solid-js";

import { isNullish } from "@pockrew/pwr-shared/libs";
import { Badge, Button } from "@pockrew/pwr-ui/core";
import { Check, ChevronDown, Copy } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import {
  detectPayload,
  parseMultipartToObject,
  parseUrlEncodedToObject,
  parseXmlToObject,
  type DetectedPayload,
} from "~/libs/content-type";
import { formatBytes } from "~/libs/format-bytes";

import { getSchemaTypeBadgeVariant, inferSchema, type SchemaNode } from "./schema-inference";

export type { SchemaNode };

/**
 * Renders a single row in the hierarchical schema tree viewer with expand/collapse and copy support.
 */
const SchemaRow: Component<{ node: SchemaNode; depth?: number }> = (props) => {
  const depth = () => props.depth ?? 0;
  const hasChildren = () => Boolean(props.node.children?.length);
  const [isOpen, setIsOpen] = createSignal(true);
  const [isCopied, setIsCopied] = createSignal(false);

  const handleCopy = (e: MouseEvent) => {
    e.stopPropagation();
    let textToCopy = "";
    if (typeof props.node.rawValue === "string") {
      textToCopy = props.node.rawValue;
    } else if (!isNullish(props.node.rawValue)) {
      textToCopy = JSON.stringify(props.node.rawValue, null, 2);
    } else if (props.node.valueSample) {
      textToCopy = props.node.valueSample;
    }

    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    }
  };

  const handleToggle = () => {
    if (hasChildren()) {
      setIsOpen(!isOpen());
    }
  };

  return (
    <div class="flex flex-col">
      <div
        class="group hover:bg-muted/40 border-border flex items-center justify-between border-b p-1 font-mono text-xs select-none"
        style={{ "padding-left": `${depth() * 10 + 5}px` }}
      >
        <Show
          when={hasChildren()}
          fallback={
            <div class="flex items-center gap-1 overflow-hidden">
              <span class="size-3.5" aria-hidden="true" />
              <span class="text-foreground truncate font-semibold">{props.node.key}</span>
            </div>
          }
        >
          <button
            type="button"
            class="focus-visible:ring-primary flex cursor-pointer items-center gap-1 overflow-hidden rounded border-none bg-transparent p-0 text-left focus:outline-none focus-visible:ring-1"
            onClick={handleToggle}
            aria-expanded={isOpen()}
            aria-label={`${isOpen() ? "Collapse" : "Expand"} ${props.node.key}`}
          >
            <ChevronDown
              class={cn(
                "text-muted-foreground duration-micro size-3.5 transition-transform",
                !isOpen() && "-rotate-90",
              )}
            />
            <span class="text-foreground truncate font-semibold">{props.node.key}</span>
          </button>
        </Show>

        <div class="flex shrink-0 items-center gap-2">
          <Show when={props.node.valueSample}>
            <span
              class="text-muted-foreground max-w-48 truncate text-xs font-normal"
              title={props.node.valueSample}
            >
              {props.node.valueSample}
            </span>
          </Show>
          <Badge
            variant={getSchemaTypeBadgeVariant(props.node.type)}
            class="h-4.5 rounded-sm px-1.5 text-xs"
          >
            {props.node.type}
          </Badge>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Copy value of ${props.node.key}`}
            class={cn(
              "hover:bg-muted text-muted-foreground hover:text-foreground flex size-5 cursor-pointer items-center justify-center rounded-sm transition-colors",
              isCopied() ? "text-emerald-500 opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            title={isCopied() ? "Copied!" : "Copy field value"}
            onClick={handleCopy}
          >
            <Show when={isCopied()} fallback={<Copy class="size-3.5" />}>
              <Check class="size-3 text-emerald-500" />
            </Show>
          </Button>
        </div>
      </div>

      <Show when={hasChildren() && isOpen()}>
        <For each={props.node.children}>
          {(child) => <SchemaRow node={child} depth={depth() + 1} />}
        </For>
      </Show>
    </div>
  );
};

export interface SchemaInspectorProps {
  value?: string | null;
  contentType?: string | null;
  class?: string;
}

/**
 * Inspector view displaying the structural schema, inferred types, and payload summary.
 */
export const SchemaInspector: Component<SchemaInspectorProps> = (props) => {
  const detected = createMemo<DetectedPayload>(() => detectPayload(props.value, props.contentType));

  const parsedData = createMemo(() => {
    if (!props.value) return null;
    const info = detected();

    // 1. JSON
    if (info.isJson && !isNullish(info.parsedObject)) {
      return info.parsedObject;
    }

    // 2. Form URL-Encoded
    if (info.isForm) {
      return parseUrlEncodedToObject(props.value);
    }

    // 3. Multipart Form
    if (info.isMultipart) {
      return parseMultipartToObject(props.value, props.contentType);
    }

    // 4. XML
    if (info.isXml) {
      return parseXmlToObject(props.value);
    }

    // Fallback: try JSON.parse
    try {
      return JSON.parse(props.value);
    } catch {
      return null;
    }
  });

  const schema = createMemo(() => {
    const data = parsedData();
    if (isNullish(data)) return null;
    return inferSchema(data, "root");
  });

  const textStats = createMemo(() => {
    const val = props.value ?? "";
    const lines = val ? val.split("\n").length : 0;
    const chars = val.length;
    const words = val.trim() ? val.trim().split(/\s+/).length : 0;
    const bytes = new TextEncoder().encode(val).length;
    return { lines, chars, words, bytes };
  });

  return (
    <div class={cn("h-full w-full overflow-y-auto", props.class)}>
      <Show
        when={schema()}
        fallback={
          <div class="flex h-full flex-col justify-center gap-3 p-3 font-mono text-xs">
            <div class="text-muted-foreground text-center">
              {props.value ? (
                <div class="border-border bg-card/50 mx-auto max-w-sm rounded border p-3 text-left">
                  <div class="text-foreground mb-2 font-bold">{detected().label}</div>
                  <div class="space-y-1 text-xs">
                    <div>
                      Lines: <span class="text-foreground font-semibold">{textStats().lines}</span>
                    </div>
                    <div>
                      Words: <span class="text-foreground font-semibold">{textStats().words}</span>
                    </div>
                    <div>
                      Characters:{" "}
                      <span class="text-foreground font-semibold">{textStats().chars}</span>
                    </div>
                    <div>
                      Payload Size:{" "}
                      <span class="text-foreground font-semibold">
                        {formatBytes(textStats().bytes)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                "No schema payload"
              )}
            </div>
          </div>
        }
      >
        {(rootNode) => (
          <div class="flex flex-col">
            <div class="bg-surface/50 border-border text-muted-foreground text-meta flex items-center gap-2 border-b p-1 font-mono uppercase">
              <span class="flex-1">Field / Key</span>
              <span>Type</span>
              <span class="size-5" />
            </div>
            <Show
              when={rootNode().children && rootNode().children!.length > 0}
              fallback={<SchemaRow node={rootNode()} />}
            >
              <For each={rootNode().children}>
                {(child) => <SchemaRow node={child} depth={0} />}
              </For>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
};

export default SchemaInspector;

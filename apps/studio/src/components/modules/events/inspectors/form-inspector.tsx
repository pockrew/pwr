import { createMemo, createSignal, For, Show, type Component } from "solid-js";

import { Badge, Button, Input } from "@pockrew/pwr-ui/core";
import { Check, Copy, FileText, Search } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { extractMimeType, parseMultipartFormData, parseUrlEncoded } from "~/libs/content-type";
import { formatBytes } from "~/libs/format-bytes";

/**
 * Form field inferred value types.
 */
export enum FormFieldTypeEnum {
  STRING = "string",
  NUMBER = "number",
  BOOLEAN = "boolean",
  JSON = "json",
  FILE = "file",
}

export interface FormInspectorProps {
  value?: string | null;
  contentType?: string | null;
  class?: string;
}

export interface FormFieldItem {
  key: string;
  decodedValue: string;
  rawValue: string;
  type: FormFieldTypeEnum;
  isFile?: boolean;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
}

/**
 * Infers the field primitive type from its string value.
 *
 * @param val - The raw parameter string value.
 * @returns Inferred FormFieldTypeEnum.
 */
export const inferFieldType = (val: string): FormFieldTypeEnum => {
  // 1. Check boolean literal
  if (val === "true" || val === "false") {
    return FormFieldTypeEnum.BOOLEAN;
  }

  // 2. Check numeric value
  if (val && !Number.isNaN(Number(val))) {
    return FormFieldTypeEnum.NUMBER;
  }

  // 3. Check JSON structure
  if ((val.startsWith("{") && val.endsWith("}")) || (val.startsWith("[") && val.endsWith("]"))) {
    try {
      JSON.parse(val);
      return FormFieldTypeEnum.JSON;
    } catch {}
  }

  // 4. Default to string
  return FormFieldTypeEnum.STRING;
};

/**
 * Resolves the Badge variant for a given form field type.
 *
 * @param type - The FormFieldTypeEnum.
 * @returns The matching Badge variant string.
 */
export const getTypeBadgeVariant = (
  type: FormFieldTypeEnum,
): "info" | "destructive" | "warning" | "secondary" | "success" => {
  switch (type) {
    case FormFieldTypeEnum.FILE:
      return "info";
    case FormFieldTypeEnum.BOOLEAN:
      return "destructive";
    case FormFieldTypeEnum.NUMBER:
      return "warning";
    case FormFieldTypeEnum.JSON:
      return "secondary";
    default:
      return "success";
  }
};

/**
 * Inspector component for URL-encoded and Multipart form payloads.
 */
export const FormInspector: Component<FormInspectorProps> = (props) => {
  const [filter, setFilter] = createSignal("");
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);

  // 1. Parse and extract fields based on payload content type
  const fields = createMemo<FormFieldItem[]>(() => {
    if (!props.value) {
      return [];
    }

    const mime = extractMimeType(props.contentType);
    const isMultipart = mime.includes("multipart") || props.value.trim().startsWith("--");

    // Multipart branch
    if (isMultipart) {
      const parts = parseMultipartFormData(props.value, props.contentType);
      return parts.map((part) => ({
        key: part.name,
        decodedValue: part.value,
        rawValue: part.value,
        type: part.isFile ? FormFieldTypeEnum.FILE : inferFieldType(part.value),
        isFile: part.isFile,
        filename: part.filename,
        contentType: part.contentType,
        sizeBytes: part.sizeBytes,
      }));
    }

    // URL-encoded branch
    const entries = parseUrlEncoded(props.value);
    return entries.map(([key, val]) => ({
      key,
      decodedValue: val,
      rawValue: encodeURIComponent(val),
      type: inferFieldType(val),
    }));
  });

  // 2. Filter fields by search query
  const filteredFields = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const list = fields();
    if (!q) {
      return list;
    }

    return list.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        f.decodedValue.toLowerCase().includes(q) ||
        (f.filename && f.filename.toLowerCase().includes(q)),
    );
  });

  // 3. Handle clipboard copying
  const handleCopy = (text: string, identifier: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(identifier);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div class={cn("flex h-full w-full flex-col overflow-hidden font-mono text-xs", props.class)}>
      {/* Search Filter Header if > 4 fields */}
      <Show when={fields().length > 4}>
        <div class="p-2">
          <Input
            placeholder="Filter form parameters and files..."
            aria-label="Filter form parameters and files"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            leftAddon={<Search class="size-4" />}
          />
        </div>
      </Show>

      {/* Structured Table */}
      <div class="flex-1 overflow-auto">
        <Show
          when={filteredFields().length > 0}
          fallback={
            <div class="text-muted-foreground flex h-full items-center justify-center p-4 text-xs">
              {props.value ? "No matching form parameters" : "Empty form payload"}
            </div>
          }
        >
          <table class="w-full border-collapse">
            <thead>
              <tr class="bg-surface/60 border-border text-muted-foreground text-meta border-b text-left font-semibold uppercase">
                <th scope="col" class="w-1/3 p-2">
                  PARAMETER
                </th>
                <th scope="col" class="p-2">
                  DECODED VALUE / FILE
                </th>
                <th scope="col" class="w-16 p-2 text-right">
                  TYPE
                </th>
                <th scope="col" class="w-8 p-2">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-border divide-y">
              <For each={filteredFields()}>
                {(field, idx) => (
                  <tr class="hover:bg-muted/30 group transition-colors">
                    <th scope="row" class="p-2 text-left align-top font-normal">
                      <span class="text-primary font-bold">{field.key}</span>
                    </th>
                    <td
                      class="text-foreground p-2 align-top font-normal break-all"
                      aria-label={
                        field.isFile
                          ? (field.filename ?? "Attachment")
                          : field.decodedValue || "empty"
                      }
                    >
                      <Show
                        when={field.isFile}
                        fallback={
                          <span>
                            {field.decodedValue || (
                              <span class="text-muted-foreground italic">(empty)</span>
                            )}
                          </span>
                        }
                      >
                        <div class="flex flex-col gap-1">
                          <div class="flex items-center gap-1.5 font-medium">
                            <FileText class="text-primary size-3.5 shrink-0" />
                            <span class="text-foreground font-semibold">
                              {field.filename ?? "Attachment"}
                            </span>
                            <Show when={field.sizeBytes}>
                              <span class="text-muted-foreground text-meta font-normal">
                                ({formatBytes(field.sizeBytes)})
                              </span>
                            </Show>
                          </div>
                          <Show when={field.contentType}>
                            <div class="text-meta text-muted-foreground">
                              MIME: <span class="text-foreground">{field.contentType}</span>
                            </div>
                          </Show>
                          <Show when={field.decodedValue}>
                            <div class="text-muted-foreground/80 bg-surface/50 text-meta max-h-16 overflow-hidden rounded p-1 font-mono break-all">
                              {field.decodedValue.length > 150
                                ? `${field.decodedValue.slice(0, 150)}...`
                                : field.decodedValue}
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </td>
                    <td class="p-2 text-right align-top">
                      <Badge
                        variant={getTypeBadgeVariant(field.type)}
                        class="text-meta h-4.5 rounded-sm px-1 uppercase"
                      >
                        {field.type}
                      </Badge>
                    </td>
                    <td class="p-2 text-right align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Copy value of ${field.key}`}
                        class={cn(
                          "hover:bg-muted text-muted-foreground hover:text-foreground flex size-5 cursor-pointer items-center justify-center rounded-sm transition-colors",
                          copiedKey() === `${field.key}-${idx()}`
                            ? "text-emerald-500 opacity-100"
                            : "opacity-0 group-hover:opacity-100",
                        )}
                        title="Copy parameter value"
                        onClick={() =>
                          handleCopy(
                            field.isFile
                              ? (field.filename ?? field.decodedValue)
                              : field.decodedValue,
                            `${field.key}-${idx()}`,
                          )
                        }
                      >
                        <Show
                          when={copiedKey() === `${field.key}-${idx()}`}
                          fallback={<Copy class="size-3" />}
                        >
                          <Check class="size-3 text-emerald-500" />
                        </Show>
                      </Button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </div>
  );
};

export default FormInspector;

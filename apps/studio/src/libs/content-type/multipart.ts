import type { MultipartPart } from "./types";

/**
 * Parses multipart/form-data payload into an array of structured MultipartPart objects.
 *
 * @param body - The raw multipart payload string.
 * @param contentTypeHeader - Optional Content-Type header containing boundary definition.
 * @returns Array of structured MultipartPart objects.
 */
export const parseMultipartFormData = (
  body?: string | null,
  contentTypeHeader?: string | null,
): MultipartPart[] => {
  // 1. Early return if body is empty or non-string
  if (!body || typeof body !== "string") {
    return [];
  }

  try {
    // 2. Extract boundary from header or infer from first line of body
    let boundary = "";
    if (contentTypeHeader) {
      const match = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
      if (match) {
        boundary = (match[1] || match[2] || "").trim();
      }
    }

    if (!boundary) {
      const firstLine = body.match(/^--([^\r\n]+)/);
      if (firstLine && firstLine[1]) {
        boundary = firstLine[1].trim();
        if (boundary.endsWith("--")) {
          boundary = boundary.slice(0, -2);
        }
      }
    }

    // 3. Early return if boundary could not be resolved
    if (!boundary) {
      return [];
    }

    // 4. Split body segments by boundary delimiter
    const delimiter = `--${boundary}`;
    const rawSegments = body.split(delimiter);
    const parts: MultipartPart[] = [];

    let partIndex = 1;
    for (const rawPart of rawSegments) {
      const trimmedPart = rawPart.replace(/^\r?\n/, "").replace(/\r?\n$/, "");

      // Skip empty segments and closing boundary marker '--'
      if (
        !trimmedPart ||
        trimmedPart === "--" ||
        trimmedPart === "--\r" ||
        trimmedPart === "--\n"
      ) {
        continue;
      }

      // 5. Separate headers block from body content
      const headerEndIdx = trimmedPart.search(/\r?\n\r?\n/);
      let headerBlock = "";
      let partValue = "";

      if (headerEndIdx !== -1) {
        headerBlock = trimmedPart.slice(0, headerEndIdx);
        const match = trimmedPart.slice(headerEndIdx).match(/^\r?\n\r?\n/);
        const delimLen = match ? match[0].length : 2;
        partValue = trimmedPart.slice(headerEndIdx + delimLen);
      } else {
        partValue = trimmedPart;
      }

      // Strip trailing delimiter marker if present
      if (partValue.endsWith("--")) {
        partValue = partValue.slice(0, -2);
      }
      partValue = partValue.replace(/\r?\n$/, "");

      // 6. Parse part header attributes
      let name = `field_${partIndex}`;
      let filename: string | undefined;
      let partContentType: string | undefined;

      const nameMatch = headerBlock.match(/name=(?:"([^"]+)"|([^\s;]+))/i);
      if (nameMatch) {
        name = (nameMatch[1] || nameMatch[2] || name).trim();
      }

      const filenameMatch = headerBlock.match(/filename=(?:"([^"]+)"|([^\s;]+))/i);
      if (filenameMatch) {
        filename = (filenameMatch[1] || filenameMatch[2] || "").trim();
      }

      const ctMatch = headerBlock.match(/content-type:\s*([^\r\n;]+)/i);
      if (ctMatch) {
        partContentType = ctMatch[1]?.trim();
      }

      const sizeBytes = new TextEncoder().encode(partValue).length;
      const isFile = Boolean(
        filename || (partContentType && !partContentType.startsWith("text/plain")),
      );

      parts.push({
        name,
        filename,
        contentType: partContentType,
        value: partValue,
        sizeBytes,
        isFile,
      });

      partIndex++;
    }

    return parts;
  } catch {
    return [];
  }
};

/**
 * Converts multipart parts into an object structure for schema and property inspection.
 *
 * @param body - The raw multipart body string.
 * @param contentTypeHeader - Optional Content-Type header containing boundary definition.
 * @returns Record of parsed multipart fields and file descriptors.
 */
export const parseMultipartToObject = (
  body?: string | null,
  contentTypeHeader?: string | null,
): Record<string, unknown> => {
  // 1. Extract parts
  const parts = parseMultipartFormData(body, contentTypeHeader);
  const result: Record<string, unknown> = {};

  // 2. Iterate through each part and create typed representations
  for (const part of parts) {
    let parsedValue: unknown = part.value;

    if (part.isFile) {
      parsedValue = {
        filename: part.filename ?? "unnamed_file",
        contentType: part.contentType ?? "application/octet-stream",
        size: part.sizeBytes,
        preview: part.value.length > 100 ? `${part.value.slice(0, 100)}...` : part.value,
      };
    } else if (part.value === "true") {
      parsedValue = true;
    } else if (part.value === "false") {
      parsedValue = false;
    } else if (part.value && !Number.isNaN(Number(part.value))) {
      parsedValue = Number(part.value);
    } else {
      try {
        parsedValue = JSON.parse(part.value);
      } catch {}
    }

    // 3. Store result with array grouping for duplicate keys
    if (Object.prototype.hasOwnProperty.call(result, part.name)) {
      const existing = result[part.name];
      if (Array.isArray(existing)) {
        existing.push(parsedValue);
      } else {
        result[part.name] = [existing, parsedValue];
      }
    } else {
      result[part.name] = parsedValue;
    }
  }

  return result;
};

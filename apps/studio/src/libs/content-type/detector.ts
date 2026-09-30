import { hasBinaryCharacters } from "./hex";
import { parseMultipartFormData, parseMultipartToObject } from "./multipart";
import type { DetectedPayload } from "./types";
import { parseUrlEncoded } from "./url-encoded";

/**
 * Extracts and normalizes the MIME type from a Content-Type header string.
 *
 * @param headerValue - The raw Content-Type header string.
 * @returns Normalized lowercase MIME string without parameters.
 */
export const extractMimeType = (headerValue?: string | null): string => {
  if (!headerValue || typeof headerValue !== "string") {
    return "";
  }
  return headerValue.split(";")[0]?.trim().toLowerCase() ?? "";
};

/**
 * Detects payload format from HTTP headers and content body sniffing.
 *
 * @param body - The raw request/response body.
 * @param contentTypeHeader - The Content-Type header value.
 * @returns Comprehensive DetectedPayload descriptor.
 */
export const detectPayload = (
  body?: string | null,
  contentTypeHeader?: string | null,
): DetectedPayload => {
  const mime = extractMimeType(contentTypeHeader);
  const trimmed = (body ?? "").trim();

  // 1. Explicit JSON Header Check
  if (mime.includes("json") || mime === "application/json") {
    try {
      const parsed = trimmed ? JSON.parse(trimmed) : null;
      return {
        format: "json",
        mimeType: mime || "application/json",
        label: "JSON",
        isJson: true,
        isForm: false,
        isMultipart: false,
        isXml: false,
        isHtml: false,
        isText: false,
        isBinary: false,
        parsedObject: parsed,
      };
    } catch {
      return {
        format: "text",
        mimeType: mime,
        label: "Raw Text (Malformed JSON)",
        isJson: false,
        isForm: false,
        isMultipart: false,
        isXml: false,
        isHtml: false,
        isText: true,
        isBinary: false,
      };
    }
  }

  // 2. Explicit URL-Encoded Form Header Check
  if (mime === "application/x-www-form-urlencoded") {
    const entries = parseUrlEncoded(trimmed);
    return {
      format: "form",
      mimeType: mime,
      label: "Form URL-Encoded",
      isJson: false,
      isForm: true,
      isMultipart: false,
      isXml: false,
      isHtml: false,
      isText: false,
      isBinary: false,
      formEntries: entries,
    };
  }

  // 3. Explicit Multipart Form Header Check
  if (mime.includes("multipart/form-data") || mime.includes("multipart/")) {
    const parts = parseMultipartFormData(trimmed, contentTypeHeader);
    const parsedObj = parseMultipartToObject(trimmed, contentTypeHeader);
    return {
      format: "multipart",
      mimeType: mime || "multipart/form-data",
      label: "Multipart Form",
      isJson: false,
      isForm: false,
      isMultipart: true,
      isXml: false,
      isHtml: false,
      isText: false,
      isBinary: false,
      multipartParts: parts,
      parsedObject: parsedObj,
    };
  }

  // 4. Explicit XML Header Check
  if (
    mime.includes("xml") ||
    mime === "text/xml" ||
    mime === "application/xml" ||
    mime.endsWith("+xml")
  ) {
    return {
      format: "xml",
      mimeType: mime || "application/xml",
      label: "XML",
      isJson: false,
      isForm: false,
      isMultipart: false,
      isXml: true,
      isHtml: false,
      isText: false,
      isBinary: false,
    };
  }

  // 5. Explicit HTML Header Check
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    return {
      format: "html",
      mimeType: mime,
      label: "HTML",
      isJson: false,
      isForm: false,
      isMultipart: false,
      isXml: false,
      isHtml: true,
      isText: false,
      isBinary: false,
    };
  }

  // 6. Sniffing fallback: JSON detection
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        format: "json",
        mimeType: mime || "application/json",
        label: "JSON (Auto-detected)",
        isJson: true,
        isForm: false,
        isMultipart: false,
        isXml: false,
        isHtml: false,
        isText: false,
        isBinary: false,
        parsedObject: parsed,
      };
    } catch {}
  }

  // 7. Sniffing fallback: XML detection
  if (
    trimmed.startsWith("<?xml") ||
    (trimmed.startsWith("<") && trimmed.endsWith(">") && !trimmed.startsWith("<!DOCTYPE html"))
  ) {
    return {
      format: "xml",
      mimeType: mime || "application/xml",
      label: "XML (Auto-detected)",
      isJson: false,
      isForm: false,
      isMultipart: false,
      isXml: true,
      isHtml: false,
      isText: false,
      isBinary: false,
    };
  }

  // 8. Sniffing fallback: HTML detection
  if (
    trimmed.startsWith("<!DOCTYPE html") ||
    (trimmed.startsWith("<html") && trimmed.endsWith("</html>"))
  ) {
    return {
      format: "html",
      mimeType: mime || "text/html",
      label: "HTML (Auto-detected)",
      isJson: false,
      isForm: false,
      isMultipart: false,
      isXml: false,
      isHtml: true,
      isText: false,
      isBinary: false,
    };
  }

  // 9. Sniffing fallback: Multipart detection
  if (trimmed.startsWith("--") && /Content-Disposition:\s*form-data/i.test(trimmed)) {
    const parts = parseMultipartFormData(trimmed, contentTypeHeader);
    const parsedObj = parseMultipartToObject(trimmed, contentTypeHeader);
    return {
      format: "multipart",
      mimeType: mime || "multipart/form-data",
      label: "Multipart Form (Auto-detected)",
      isJson: false,
      isForm: false,
      isMultipart: true,
      isXml: false,
      isHtml: false,
      isText: false,
      isBinary: false,
      multipartParts: parts,
      parsedObject: parsedObj,
    };
  }

  // 10. Sniffing fallback: URL-encoded Form detection
  if (
    trimmed.includes("=") &&
    (trimmed.includes("&") || !trimmed.includes("\n")) &&
    !trimmed.includes("{") &&
    !trimmed.includes("<")
  ) {
    try {
      const params = new URLSearchParams(trimmed);
      const entries = Array.from(params.entries());
      if (
        entries.length > 0 &&
        entries.every(([k]) => k.length > 0 && !k.includes(" ") && !k.includes("\n"))
      ) {
        return {
          format: "form",
          mimeType: mime || "application/x-www-form-urlencoded",
          label: "Form URL-Encoded (Auto-detected)",
          isJson: false,
          isForm: true,
          isMultipart: false,
          isXml: false,
          isHtml: false,
          isText: false,
          isBinary: false,
          formEntries: entries,
        };
      }
    } catch {}
  }

  // 11. Sniffing fallback: Binary / Hex Dump
  if (hasBinaryCharacters(trimmed)) {
    return {
      format: "hex",
      mimeType: mime || "application/octet-stream",
      label: "Binary / Hex Dump",
      isJson: false,
      isForm: false,
      isMultipart: false,
      isXml: false,
      isHtml: false,
      isText: false,
      isBinary: true,
    };
  }

  // 12. Default Plain Text Fallback
  return {
    format: "text",
    mimeType: mime || "text/plain",
    label: "Plain Text",
    isJson: false,
    isForm: false,
    isMultipart: false,
    isXml: false,
    isHtml: false,
    isText: true,
    isBinary: false,
  };
};

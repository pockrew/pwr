/**
 * Enumeration of supported payload formats.
 */
export enum PayloadFormatEnum {
  JSON = "json",
  FORM = "form",
  MULTIPART = "multipart",
  XML = "xml",
  HTML = "html",
  TEXT = "text",
  HEX = "hex",
}

export type PayloadFormat = "json" | "form" | "multipart" | "xml" | "html" | "text" | "hex";

/**
 * Represents a single parsed part of a multipart/form-data payload.
 */
export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  value: string;
  sizeBytes: number;
  isFile: boolean;
}

/**
 * Comprehensive detection descriptor for a webhook payload.
 */
export interface DetectedPayload {
  format: PayloadFormat;
  mimeType: string;
  label: string;
  isJson: boolean;
  isForm: boolean;
  isMultipart: boolean;
  isXml: boolean;
  isHtml: boolean;
  isText: boolean;
  isBinary: boolean;
  parsedObject?: unknown;
  formEntries?: [string, string][];
  multipartParts?: MultipartPart[];
}

/**
 * Outcome descriptor when validating comparability between two webhook events.
 */
export interface EventComparisonResult {
  comparable: boolean;
  reason?: string;
  typeA?: string;
  typeB?: string;
  formatA?: string;
  formatB?: string;
}

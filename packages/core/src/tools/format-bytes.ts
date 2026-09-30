/**
 * Formats a byte size number into human-readable string (e.g., 0 B, 512 B, 1.2 KB, 3.4 MB).
 *
 * @param bytes - Numeric size in bytes.
 * @returns Formatted human-readable string.
 */
export const formatBytes = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0 || Number.isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  if (i === 0) return `${bytes} B`;
  const val = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${val.endsWith(".0") ? val.slice(0, -2) : val} ${units[i]}`;
};

/**
 * Calculates byte size of a payload given optional body string and raw base64 string.
 *
 * @param body - Optional text or raw body.
 * @param rawPayloadBase64 - Optional base64-encoded raw payload.
 * @returns Byte length of the payload.
 */
export const calculatePayloadBytes = (
  body?: string | null,
  rawPayloadBase64?: string | null,
): number => {
  if (rawPayloadBase64 && rawPayloadBase64.length > 0) {
    return Buffer.from(rawPayloadBase64, "base64").byteLength;
  }
  if (body && body.length > 0) {
    return Buffer.byteLength(body, "utf-8");
  }
  return 0;
};

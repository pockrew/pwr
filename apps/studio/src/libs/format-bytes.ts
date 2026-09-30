/**
 * Formats a byte size into human-readable text (e.g. 0 B, 450 B, 1.2 KB, 3.4 MB).
 */
export const formatBytes = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0 || Number.isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  if (i === 0) return `${bytes} B`;
  const val = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${val.endsWith(".0") ? val.slice(0, -2) : val} ${units[i]}`;
};

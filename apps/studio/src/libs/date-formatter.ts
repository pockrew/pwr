/**
 * Formats an ISO datetime string into Vietnamese date and time display.
 * Needed to display chronological order creation, update, and pickup timestamps.
 */
export const formatIsoText = (iso?: number | string | null): string => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

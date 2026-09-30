/**
 * Canonicalize a literal endpoint selector for both management and ingress matching.
 * @param path - Validated management path or a stored ingress selector.
 * @returns Path without its optional leading slash; body/query bytes are never inspected.
 */
export const normalizeEndpointPath = (path: string): string => path.replace(/^\/+/, "");

/**
 * Turn a bounded limit+1 query into a stable ID-cursor page.
 * @param rows - Rows ordered by ascending unique ID, including at most one lookahead row.
 * @param limit - Validated positive page size.
 * @returns Visible rows and the exclusive next cursor, or null at the end.
 */
export const managementPage = <T extends { id: string }>(rows: T[], limit: number) => {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
};

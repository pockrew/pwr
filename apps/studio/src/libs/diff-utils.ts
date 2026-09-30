import { isNullish, isRecord } from "@pockrew/pwr-shared/libs";

export * from "./diff-types";
export { computeAlignedDiff } from "./aligned-diff";
export { computeFallbackTextDiff } from "./fallback-diff";
export { computeSideBySideDiff } from "./side-by-side-diff";

export const formatDiffSource = (data: unknown): string => {
  if (isNullish(data)) {
    return "";
  }

  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(sortObjectKeys(parsed), null, 2);
    } catch {
      return data;
    }
  }

  if (isRecord(data) || Array.isArray(data)) {
    return JSON.stringify(sortObjectKeys(data), null, 2);
  }

  return String(data);
};

export const sortObjectKeys = (val: unknown): unknown => {
  if (Array.isArray(val)) {
    return val.map(sortObjectKeys);
  }
  if (isRecord(val)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(val).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      sorted[key] = sortObjectKeys(val[key]);
    }
    return sorted;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return sortObjectKeys(parsed);
      } catch {
        return val;
      }
    }
  }
  return val;
};

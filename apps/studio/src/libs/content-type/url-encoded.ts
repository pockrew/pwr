/**
 * Parses a standard URL-encoded string into key-value tuple pairs safely.
 *
 * @param input - The raw form-urlencoded string.
 * @returns Array of key-value string tuples.
 */
export const parseUrlEncoded = (input?: string | null): [string, string][] => {
  // 1. Validate input and return early if empty
  if (!input || typeof input !== "string") {
    return [];
  }

  // 2. Parse key-value pairs safely using URLSearchParams
  try {
    const params = new URLSearchParams(input.trim());
    return Array.from(params.entries());
  } catch {
    return [];
  }
};

/**
 * Converts form-urlencoded entries into a nested, typed record object for schema inspection.
 *
 * @param input - The raw form-urlencoded string.
 * @returns Record of parsed keys with type-inferred primitive values.
 */
export const parseUrlEncodedToObject = (input?: string | null): Record<string, unknown> => {
  // 1. Return empty object early if no input
  if (!input) {
    return {};
  }

  const entries = parseUrlEncoded(input);
  const result: Record<string, unknown> = {};

  // 2. Process each key-value pair and infer types
  for (const [key, value] of entries) {
    let parsedValue: unknown = value;

    if (value === "true") {
      parsedValue = true;
    } else if (value === "false") {
      parsedValue = false;
    } else if (value && !Number.isNaN(Number(value))) {
      parsedValue = Number(value);
    }

    // 3. Handle multiple occurrences of the same key as an array
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(parsedValue);
      } else {
        result[key] = [existing, parsedValue];
      }
    } else {
      result[key] = parsedValue;
    }
  }

  return result;
};

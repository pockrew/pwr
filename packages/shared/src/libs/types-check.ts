export type Primitive = string | number | boolean;

/**
 * Type guard checking whether a value is null or undefined.
 *
 * @param val - Unknown value to inspect.
 * @returns True if value is null or undefined, false otherwise.
 */
export const isNullish = (val: unknown): val is null | undefined =>
  val === null || val === undefined;

/**
 * Type guard checking whether a value is a primitive (boolean, number, or string).
 *
 * @param val - Unknown value to inspect.
 * @returns True if value is boolean, number, or string, false otherwise.
 */
export const isPrimitive = (val: unknown): val is Primitive =>
  typeof val === "boolean" || typeof val === "number" || typeof val === "string";

/**
 * Type guard checking whether a value is a non-null, non-array object record.
 *
 * @param val - Unknown value to inspect.
 * @returns True if value is a dictionary-like object record, false otherwise.
 */
export const isRecord = (val: unknown): val is Record<string, unknown> =>
  typeof val === "object" && val !== null && !Array.isArray(val);

/**
 * Serializes a primitive or nullish value to string format.
 *
 * @param val - Value to serialize.
 * @returns Serialized string representation, or undefined if not primitive.
 */
export const serializePrimitive = (val: unknown): string | undefined => {
  // 1. Handle null and undefined cases
  if (isNullish(val)) return "null";

  // 2. Stringify primitive scalar values
  if (isPrimitive(val)) return JSON.stringify(val);

  // 3. Return undefined for complex objects/arrays
  return undefined;
};

/**
 * Exhaustive union check assertion helper for TypeScript switch statements.
 *
 * @param val - Value statically typed as never.
 * @param message - Optional custom error message.
 * @throws Error indicating unhandled discriminated union variant.
 */
export const assertNever = (val: never, message?: string): never => {
  throw new Error(message ?? `Unhandled union variant: ${JSON.stringify(val)}`);
};

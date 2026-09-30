import type { LogRecord, Sink } from "@logtape/logtape";

/**
 * Keys whose values never reach a log: credentials, sessions, signatures and webhook bodies.
 * Matched case-insensitively anywhere in the key (`x-api-key`, `relayKey`, `targetSecret`).
 */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|relay[-_]?key|authori[sz]ation|cookie|session|credential|private[-_]?key|signature|^(payload|body|raw[-_]?body|payload[-_]?base64)$/i;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
const PLACEHOLDER = /\{([^{}]+)\}/g;

/** True for a property or placeholder name whose value must be masked. */
export const isSensitiveLogKey = (key: string): boolean => SENSITIVE_KEY.test(key);

/**
 * Copy of a logged value that is safe to write anywhere.
 * 1. Errors keep only name and code: messages and stacks can embed query parameters (payloads).
 * 2. Sensitive keys are masked at every depth; deep or cyclic structures are cut off.
 * 3. The result is always JSON-serializable (bigint becomes a string, dates ISO text).
 */
export const redactLogValue = (value: unknown, depth = 0): unknown => {
  if (value instanceof Error) {
    const code = "code" in value && typeof value.code === "string" ? value.code : undefined;
    return { name: value.name, ...(code ? { code } : {}) };
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object" || value === null) return value;
  if (depth >= MAX_DEPTH) return "[deep]";
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      isSensitiveLogKey(key) ? REDACTED : redactLogValue(inner, depth + 1),
    ]),
  );
};

/** Masked record: properties, plus interpolated message values whose placeholder is sensitive. */
const redactRecord = (record: LogRecord): LogRecord => {
  const names =
    typeof record.rawMessage === "string"
      ? [...record.rawMessage.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "")
      : [];
  const message = record.message.map((part, index) => {
    if (index % 2 === 0) return part;
    return isSensitiveLogKey(names[(index - 1) / 2] ?? "") ? REDACTED : redactLogValue(part);
  });
  const properties = redactLogValue(record.properties);
  return {
    ...record,
    message,
    properties: typeof properties === "object" && properties !== null ? { ...properties } : {},
  };
};

/**
 * Wrap a sink so it only ever receives masked records. Every sink is wrapped at configuration,
 * so a sink added later (a log shipper, say) cannot bypass masking. Disposal is forwarded so the
 * file sink still flushes and closes.
 */
export const redactingSink = (sink: Sink & Partial<AsyncDisposable>): Sink & AsyncDisposable =>
  Object.assign((record: LogRecord) => sink(redactRecord(record)), {
    [Symbol.asyncDispose]: async () => {
      await sink[Symbol.asyncDispose]?.();
    },
  });

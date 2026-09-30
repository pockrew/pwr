/** Readable text for the server's error codes (`{ code, requestId }` envelope). */
const ERROR_TEXT: Record<string, string> = {
  UNAUTHORIZED: "Your session has expired; sign in again.",
  FORBIDDEN: "You are not allowed to do this.",
  NOT_FOUND: "It no longer exists.",
  CONFLICT: "It conflicts with an existing record (for example a slug already in use).",
  VALIDATION_ERROR: "Some values are invalid.",
  DATABASE_UNAVAILABLE: "The server database is unavailable; try again.",
  INTERNAL_ERROR: "The server failed to handle the request.",
  SIGNING_UNAVAILABLE:
    "Set WEBHOOK_SIGNING_ENCRYPTION_KEY on the server and restart it to use provider signatures.",
};

const errorCodeOf = async (response: { json(): Promise<unknown> }): Promise<string | null> => {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
    ? body.code
    : null;
};

/**
 * Unwrap the server's `{ data }` envelope; a non-2xx answer becomes an error that says what failed
 * and why (from the error code).
 */
export const readData = async <T>(
  response: { ok: boolean; status: number; json(): Promise<unknown> } & {
    json(): Promise<{ data: T }>;
  },
  failure: string,
): Promise<T> => {
  if (!response.ok) {
    const code = await errorCodeOf(response);
    const reason = code ? (ERROR_TEXT[code] ?? code) : `HTTP ${response.status}`;
    throw new Error(`${failure}: ${reason}`);
  }
  return (await response.json()).data;
};

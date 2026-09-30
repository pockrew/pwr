// @server-only

import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { isRecord } from "@pockrew/pwr-shared/libs";
import { ErrorCodes, type ApiErrorResponse, type IErrorCode } from "@pockrew/pwr-shared/schemas";

import { log } from "./logger.middleware";
import type { AppEnv } from "./types";

export class AppError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    public readonly code: IErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(status, { message });
  }
}

const SENSITIVE_KEY_PATTERN = /pin|otp|token|secret|password|credential|cookie|connection/i;

/**
 * Recursively redacts sensitive keys (tokens, secrets, passwords, cookies) from error diagnostic context.
 *
 * @param ctx - Context record to sanitize.
 * @returns Redacted context object, or undefined if input was undefined.
 */
export const redactDiagnosticContext = (
  ctx?: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  // 1. Return undefined if no diagnostic context provided
  if (!ctx) return undefined;
  const result: Record<string, unknown> = {};

  // 2. Iterate keys and redact matching sensitive terms or recurse into nested objects
  for (const [key, value] of Object.entries(ctx)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
    } else if (isRecord(value)) {
      result[key] = redactDiagnosticContext(value);
    } else {
      result[key] = value;
    }
  }

  // 3. Return sanitized diagnostic object
  return result;
};

/**
 * Creates an HTTP 400 Bad Request application error.
 *
 * @param message - Descriptive failure message.
 * @param context - Optional diagnostic context.
 */
export const validationError = (
  message = "Validation error",
  context?: Record<string, unknown>,
): AppError => new AppError(400, "VALIDATION_ERROR", message, context);

/**
 * Creates an HTTP 403 Forbidden application error.
 *
 * @param message - Descriptive failure message.
 * @param context - Optional diagnostic context.
 */
export const forbiddenError = (
  message = "Access forbidden",
  context?: Record<string, unknown>,
): AppError => new AppError(403, "FORBIDDEN", message, context);

/**
 * Creates an HTTP 404 Not Found application error.
 *
 * @param message - Descriptive failure message.
 * @param context - Optional diagnostic context.
 */
export const notFoundError = (
  message = "Resource not found",
  context?: Record<string, unknown>,
): AppError => new AppError(404, "NOT_FOUND", message, context);

/**
 * Creates an HTTP 503 Database Unavailable application error.
 *
 * @param message - Descriptive failure message.
 * @param context - Optional diagnostic context.
 */
export const databaseUnavailableError = (
  message = "Database unavailable",
  context?: Record<string, unknown>,
): AppError => new AppError(503, "DATABASE_UNAVAILABLE", message, context);

/**
 * Creates an HTTP 500 Internal Server Error application error.
 *
 * @param message - Descriptive failure message.
 * @param context - Optional diagnostic context.
 */
export const internalError = (
  message = "Internal server error",
  context?: Record<string, unknown>,
): AppError => new AppError(500, "INTERNAL_ERROR", message, context);

/**
 * Global 404 handler returning standardized API_NOT_FOUND error response.
 *
 * @param c - Hono request context.
 * @returns Not found error response.
 */
export const apiNotFound: NotFoundHandler<AppEnv> = (c) => sendError(c, "API_NOT_FOUND", 404);

/**
 * Extracts the current request trace ID from the Hono context.
 *
 * @param c - Hono request context.
 * @returns Request ID string or empty string.
 */
export const requestIdOf = (c: Context<AppEnv>): string => c.get("requestId") ?? "";

/**
 * Maps an HTTP numeric status code to the standardized ErrorCode enum value.
 *
 * @param status - Numeric HTTP status code.
 * @returns Standardized ErrorCode identifier.
 */
const mapStatusToCode = (status: number): IErrorCode => {
  switch (status) {
    case 400:
      return ErrorCodes.VALIDATION_ERROR;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 413:
      return ErrorCodes.REQUEST_TOO_LARGE;
    case 415:
      return ErrorCodes.UNSUPPORTED_MEDIA_TYPE;
    case 503:
      return ErrorCodes.DATABASE_UNAVAILABLE;
    case 504:
      return ErrorCodes.REQUEST_TIMEOUT;
    default:
      return ErrorCodes.INTERNAL_ERROR;
  }
};

/**
 * Dispatches a formatted JSON error envelope response with appropriate headers.
 *
 * @param c - Hono request context.
 * @param code - Standardized error code identifier.
 * @param status - Contentful HTTP response status code.
 * @returns Hono JSON Response.
 */
export const sendError = (
  c: Context<AppEnv>,
  code: IErrorCode,
  status: ContentfulStatusCode,
): Response => {
  // 1. Resolve active request ID from context
  const requestId = requestIdOf(c);

  // 2. Build JSON response envelope matching ApiErrorResponse schema
  const res = c.json({ code, requestId } satisfies ApiErrorResponse, status);

  // 3. Attach tracing and anti-caching headers
  res.headers.set("x-request-id", requestId);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
};

/**
 * Global application error handler middleware mapping exceptions to standardized API JSON envelopes.
 *
 * @param err - Uncaught error instance.
 * @param c - Hono request context.
 * @returns Standardized error response.
 */
export const handleError: ErrorHandler<AppEnv> = (err, c) => {
  // 1. Resolve request ID for correlation
  const requestId = requestIdOf(c);

  // 2. Map domain AppError exceptions
  if (err instanceof AppError) {
    log.warn({ event: "request.app_error", ...redactDiagnosticContext({ ...err }) }, requestId);
    return sendError(c, err.code, err.status);
  }

  // 3. Map framework HTTPException instances
  if (err instanceof HTTPException) {
    const code = mapStatusToCode(err.status);
    log.warn({ event: "request.http_error", ...redactDiagnosticContext({ ...err }) }, requestId);
    return sendError(c, code, err.status);
  }

  // 4. Map schema ZodError validation issues
  if (err instanceof ZodError) {
    log.warn({ event: "request.validation_error", err }, requestId);
    return sendError(c, "VALIDATION_ERROR", 400);
  }

  // 5. Fallback for unhandled unexpected exceptions
  log.error({ event: "request.unhandled", err }, requestId);
  return sendError(c, "INTERNAL_ERROR", 500);
};

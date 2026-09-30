import { getLogger } from "@logtape/logtape";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import {
  type ApiErrorResponse,
  type ApiSuccessResponse,
  type IErrorCode,
} from "@pockrew/pwr-shared/schemas";

const logger = getLogger(["pwr", "agent", "http"]);

/** One request ID follows the request through success, failure and the response header. */
export const requestIdOf = (c: Context): string => {
  const reqId = c.get("requestId");
  return typeof reqId === "string" ? reqId : crypto.randomUUID();
};

export const sendData = <T>(c: Context, data: T) =>
  c.json({ data, requestId: requestIdOf(c) } satisfies ApiSuccessResponse<T>);

export const sendError = (c: Context, code: IErrorCode, status: ContentfulStatusCode) =>
  c.json({ code, requestId: requestIdOf(c) } satisfies ApiErrorResponse, status);

/** Keep local failures opaque: keys, webhook bodies and database details never enter responses. */
export const handleLocalError: ErrorHandler = (error, c) => {
  if (error instanceof ZodError) return sendError(c, "VALIDATION_ERROR", 400);
  if (error instanceof HTTPException) {
    switch (error.status) {
      case 400:
        return sendError(c, "VALIDATION_ERROR", 400);
      case 401:
        return sendError(c, "UNAUTHORIZED", 401);
      case 403:
        return sendError(c, "FORBIDDEN", 403);
      case 404:
        return sendError(c, "NOT_FOUND", 404);
      case 409:
        return sendError(c, "CONFLICT", 409);
      case 413:
        return sendError(c, "REQUEST_TOO_LARGE", 413);
      case 507:
        return sendError(c, "STORAGE_FULL", 507);
    }
  }
  // Only the error class is logged: messages can carry payload bytes or local paths.
  logger.error("Local request failed with {errorName}", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return sendError(c, "INTERNAL_ERROR", 500);
};

export const localNotFound: NotFoundHandler = (c) => sendError(c, "API_NOT_FOUND", 404);

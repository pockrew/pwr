import { z } from "zod";

const ErrorCodeSchema = z.enum([
  "API_NOT_FOUND",
  "INTERNAL_ERROR",
  "DATABASE_UNAVAILABLE",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "NOT_FOUND",
  "STORAGE_FULL",
  "REQUEST_TIMEOUT",
  "REQUEST_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "TUNNEL_NOT_FOUND",
  "TUNNEL_INACTIVE",
  "FORWARD_FAILED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "IP_FORBIDDEN",
  "BUFFER_SATURATED",
  "SIGNING_UNAVAILABLE",

  // CLIENT
  "INVALID_RESPONSE",
]);

export const ErrorCodes = ErrorCodeSchema.enum;

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type IErrorCode = ErrorCode;

export const ApiErrorResponseSchema = z.strictObject({
  code: ErrorCodeSchema,
  requestId: z.string().min(1).max(64),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/**
 * Factory producing a typed Zod schema for successful API response envelopes containing a requestId.
 *
 * @param dataSchema - Schema validating the payload data field.
 * @returns Zod object schema for the API response envelope.
 */
export const ApiSuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.strictObject({
    data: dataSchema,
    requestId: z.string().min(1).max(64),
  });

export interface ApiSuccessResponse<T> {
  data: T;
  requestId: string;
}

export const McpToolErrorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  isRetryable: z.boolean(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type McpToolError = z.infer<typeof McpToolErrorSchema>;

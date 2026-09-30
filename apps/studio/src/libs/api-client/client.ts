import { hc } from "hono/client";

import type { AppType } from "@pockrew/pwr-agent/rpc";
import { isRecord } from "@pockrew/pwr-shared/libs";
import {
  ApiErrorResponseSchema,
  ErrorCodes,
  type ApiErrorResponse,
} from "@pockrew/pwr-shared/schemas";

import { ERROR_MESSAGES } from "./error-message";

export const rpc = hc<AppType>("/api", {
  init: { credentials: "include" },
});

export type RpcType = typeof rpc;

/**
 * Truncates and normalizes request identifier headers to a safe bounded string.
 */
const boundedRequestId = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const bounded = value.trim().slice(0, 64);
  return bounded.length ? bounded : undefined;
};

/**
 * Constructs an application error carrying a standardized code and optional request identifier.
 */
const clientError = (cause: ApiErrorResponse): Error => {
  const message = ERROR_MESSAGES[cause.code] ?? "Something went wrong. Please try again.";
  return new Error(message, { cause });
};

export type SuccessStatusCode = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;

export type ExtractRpcSuccess<R> = R extends {
  status: infer S;
  json(): Promise<infer T>;
}
  ? S extends SuccessStatusCode
    ? T extends { data: infer D }
      ? D
      : T
    : number extends S
      ? T extends { data: infer D }
        ? D
        : T
      : never
  : R extends { json(): Promise<infer T> }
    ? T extends { data: infer D }
      ? D
      : T
    : unknown;

export type RpcResponseLike = {
  ok: boolean;
  status: number;
  headers: Headers;
  json(): Promise<unknown>;
};

export class RpcHttpError extends Error {
  code?: string;
  status: number;
  requestId: string;

  constructor(message: string, status: number, requestId: string, code?: string) {
    super(message);
    this.name = "RpcHttpError";
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}

/**
 * Unwraps a typed Hono RPC JSON response or extracts the error details.
 */
export const unwrapRpc = async <R extends RpcResponseLike>(
  responsePromise: Promise<R> | R,
): Promise<ExtractRpcSuccess<R>> => {
  const response = await responsePromise;
  const headerRequestId = boundedRequestId(response.headers.get("x-request-id")) ?? "n/a";
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();

  if (contentType && !contentType.includes("json")) {
    throw clientError({ code: ErrorCodes.INVALID_RESPONSE, requestId: headerRequestId });
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw clientError({ code: ErrorCodes.INVALID_RESPONSE, requestId: headerRequestId });
    }

    if (isRecord(body)) {
      const parsed = ApiErrorResponseSchema.safeParse(body);
      if (parsed.success) {
        throw clientError({
          code: parsed.data.code,
          requestId: boundedRequestId(parsed.data.requestId) ?? headerRequestId,
        });
      }

      const bodyObj = body;
      const code =
        typeof bodyObj.code === "string"
          ? bodyObj.code
          : typeof bodyObj.error === "string"
            ? bodyObj.error
            : undefined;
      const message =
        typeof bodyObj.message === "string"
          ? bodyObj.message
          : ((code ? ERROR_MESSAGES[code] : undefined) ??
            `Request failed with status ${response.status}`);

      throw new RpcHttpError(
        message,
        response.status,
        typeof bodyObj.requestId === "string" ? bodyObj.requestId : headerRequestId,
        code,
      );
    }

    throw clientError({ code: ErrorCodes.INVALID_RESPONSE, requestId: headerRequestId });
  }

  const isSuccessPayload = <T>(_val: unknown): _val is T => true;

  try {
    const body = await response.json();
    if (isRecord(body) && "data" in body) {
      const data = body["data"];
      if (isSuccessPayload<ExtractRpcSuccess<R>>(data)) {
        return data;
      }
    }
    if (isSuccessPayload<ExtractRpcSuccess<R>>(body)) {
      return body;
    }
    throw clientError({ code: ErrorCodes.INVALID_RESPONSE, requestId: headerRequestId });
  } catch {
    throw clientError({ code: ErrorCodes.INVALID_RESPONSE, requestId: headerRequestId });
  }
};

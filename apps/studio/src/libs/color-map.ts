import { isNullish } from "@pockrew/pwr-shared/libs";
import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";
import type { BadgeProps } from "@pockrew/pwr-ui/core";

/**
 * Standard HTTP Method Enum.
 */
export enum HttpMethodEnum {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
}

/**
 * Resolves the Badge UI variant based on the HTTP response status code.
 *
 * @param status - The numeric HTTP status code.
 * @returns The matching BadgeProps variant.
 */
export const getEventStatusColor = (
  status?: WebhookEvent["status"] | null,
): BadgeProps["variant"] => {
  // 1. Early return default variant if status is not defined
  if (isNullish(status)) {
    return "default";
  }

  // 2. Exact match 2xx success
  if (status >= 200 && status < 300) {
    return "success";
  }

  // 3. Exact match 4xx client errors & 5xx server errors
  if (status >= 400) {
    return "destructive";
  }

  // 4. Match 3xx redirection
  if (status >= 300) {
    return "warning";
  }

  // 5. Fallback
  return "default";
};

/**
 * Resolves Tailwind styling classes for HTTP Method indicators and badges.
 *
 * @param method - The HTTP method string.
 * @returns Tailwind CSS class string for background and border colors.
 */
export const getMethodColor = (method?: WebhookEvent["method"] | string | null): string => {
  // 1. Early return if method is not defined
  if (!method) {
    return "bg-surface border-border";
  }

  // 2. Match method via clean switch/case
  const normalized = method.toUpperCase();
  switch (normalized) {
    case HttpMethodEnum.POST:
      return "bg-info/50 border border-info/20";
    case HttpMethodEnum.GET:
      return "bg-success/50 border border-success/20";
    case HttpMethodEnum.PUT:
    case HttpMethodEnum.PATCH:
      return "bg-warning/50 border border-warning/25";
    case HttpMethodEnum.DELETE:
      return "bg-destructive/50 border border-destructive/20";
    default:
      return "bg-surface border-border";
  }
};

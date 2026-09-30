import { type IErrorCode } from "@pockrew/pwr-shared/schemas";

export const ERROR_MESSAGES: Record<IErrorCode | string, string> = {
  API_NOT_FOUND: "This endpoint does not exist.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  DATABASE_UNAVAILABLE: "The agent cannot process the request right now.",
  VALIDATION_ERROR: "The submitted data is invalid.",
  BAD_REQUEST: "The submitted data is invalid.",
  UNAUTHORIZED: "Not signed in to the agent. Run `pwr studio` to open Studio.",
  FORBIDDEN: "You are not allowed to perform this action.",
  NOT_FOUND: "The requested resource was not found.",
  CONFLICT: "The data conflicts with the current state.",
  STORAGE_FULL: "Local storage is full; intake is paused.",
  REQUEST_TIMEOUT: "The request timed out.",
  REQUEST_TOO_LARGE: "The request is too large.",
  UNSUPPORTED_MEDIA_TYPE: "Unsupported content type.",
  TUNNEL_NOT_FOUND: "Tunnel not found.",
  TUNNEL_INACTIVE: "The tunnel is inactive.",
  FORWARD_FAILED: "Could not forward the webhook to the local target.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  QUOTA_EXCEEDED: "The webhook quota has been exceeded.",
  IP_FORBIDDEN: "This IP address is not allowed.",
  BUFFER_SATURATED: "The webhook queue is saturated. Please try again later.",

  // CLIENT
  INVALID_RESPONSE: "The agent returned an invalid response.",
};

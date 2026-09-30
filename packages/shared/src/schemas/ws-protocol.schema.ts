import { z } from "zod";

import { ReplayResultSchema } from "./tunnel.schema";
import { WebhookEventSchema } from "./webhook.schema";

export const WsClientMessageTypeSchema = z.enum([
  "subscribe",
  "forward_result",
  "replay_result",
  "pause_tunnel",
  "resume_tunnel",
  "ping",
]);
export type WsClientMessageType = z.infer<typeof WsClientMessageTypeSchema>;
export const WsClientMessageTypes = WsClientMessageTypeSchema.enum;

export const WsClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal(WsClientMessageTypes.subscribe),
    tunnelId: z.string().min(1).max(64),
    apiKey: z.string().optional(),
    secret: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal(WsClientMessageTypes.forward_result),
    webhookId: z.string().uuid(),
    tunnelId: z.string().min(1).max(64),
    destinationId: z.string().optional(),
    targetUrl: z.string().optional(),
    statusCode: z.number().int(),
    latencyMs: z.number().nonnegative(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    responseBody: z.string().optional(),
  }),
  ReplayResultSchema.extend({
    type: z.literal(WsClientMessageTypes.replay_result),
  }),
  z.strictObject({
    type: z.literal(WsClientMessageTypes.pause_tunnel),
    tunnelId: z.string().min(1).max(64),
  }),
  z.strictObject({
    type: z.literal(WsClientMessageTypes.resume_tunnel),
    tunnelId: z.string().min(1).max(64),
  }),
  z.strictObject({
    type: z.literal(WsClientMessageTypes.ping),
    timestamp: z.number().int().positive(),
  }),
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const WsServerMessageTypeSchema = z.enum([
  "subscribed",
  "webhook_event",
  "replay_command",
  "tunnel_paused",
  "tunnel_resumed",
  "pong",
  "error",
]);
export type WsServerMessageType = z.infer<typeof WsServerMessageTypeSchema>;
export const WsServerMessageTypes = WsServerMessageTypeSchema.enum;

export const WsServerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal(WsServerMessageTypes.subscribed),
    tunnelId: z.string().min(1).max(64),
    activeAgents: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal(WsServerMessageTypes.webhook_event),
    event: WebhookEventSchema,
  }),
  z.strictObject({
    type: z.literal(WsServerMessageTypes.replay_command),
    commandId: z.string().uuid(),
    webhookId: z.string().uuid(),
    event: WebhookEventSchema,
    targetUrl: z.url().optional(),
    headersOverride: z.record(z.string(), z.string()).optional(),
  }),
  z.strictObject({
    type: z.literal(WsServerMessageTypes.tunnel_paused),
    tunnelId: z.string().min(1).max(64),
  }),
  z.strictObject({
    type: z.literal(WsServerMessageTypes.tunnel_resumed),
    tunnelId: z.string().min(1).max(64),
  }),
  z.strictObject({
    type: z.literal(WsServerMessageTypes.pong),
    timestamp: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal(WsServerMessageTypes.error),
    code: z.string(),
    message: z.string(),
  }),
]);

export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

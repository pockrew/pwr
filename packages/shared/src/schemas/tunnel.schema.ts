import { z } from "zod";

import { FanoutDestinationSchema } from "./destination.schema";

export const TunnelConfigSchema = z.strictObject({
  id: z.string().min(1).max(64),
  orgId: z.string().min(1).max(64).default("default"),
  projectId: z.string().min(1).max(64).default("default"),
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
  cluster: z.string().min(1).max(64).optional(),
  targetUrl: z.url().default("http://localhost:3000"),
  destinations: z.array(FanoutDestinationSchema).optional(),
  isActive: z.boolean().default(true),
  isPaused: z.boolean().default(false),
  secretToken: z.string().min(8).max(128).optional(),
  allowedIps: z.array(z.string()).optional(),
  deniedIps: z.array(z.string()).optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type TunnelConfig = z.infer<typeof TunnelConfigSchema>;

export const TunnelStatusSchema = z.strictObject({
  tunnelId: z.string().min(1).max(64),
  orgId: z.string().min(1).max(64).default("default"),
  projectId: z.string().min(1).max(64).default("default"),
  isOnline: z.boolean(),
  isPaused: z.boolean().default(false),
  connectedAgents: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().positive().optional(),
});

export type TunnelStatus = z.infer<typeof TunnelStatusSchema>;

export const CreateTunnelInputSchema = z.strictObject({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(100).optional(),
  projectId: z.string().min(1).max(64).default("default"),
  targetUrl: z.url().optional(),
  destinations: z.array(FanoutDestinationSchema).optional(),
  allowedIps: z.array(z.string()).optional(),
  deniedIps: z.array(z.string()).optional(),
});

export type CreateTunnelInput = z.infer<typeof CreateTunnelInputSchema>;

export const ListTunnelsQuerySchema = z.strictObject({
  projectId: z.string().optional(),
});

export type ListTunnelsQuery = z.infer<typeof ListTunnelsQuerySchema>;

export const ListWebhooksQuerySchema = z.strictObject({
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type ListWebhooksQuery = z.infer<typeof ListWebhooksQuerySchema>;

export const ReplayWebhookInputSchema = z.strictObject({
  targetUrl: z.url().optional(),
  headersOverride: z.record(z.string(), z.string()).optional(),
});

export type ReplayWebhookInput = z.infer<typeof ReplayWebhookInputSchema>;

export const ReplayResultSchema = z.strictObject({
  commandId: z.string().uuid(),
  webhookId: z.string().uuid(),
  tunnelId: z.string().min(1).max(64),
  statusCode: z.number().int(),
  latencyMs: z.number().nonnegative(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  responseBody: z.string().optional(),
});

export type ReplayResult = z.infer<typeof ReplayResultSchema>;

export const TunnelParamSchema = z.strictObject({
  tunnelId: z.string().min(1).max(64),
});

export type TunnelParam = z.infer<typeof TunnelParamSchema>;

export const WebhookParamSchema = z.strictObject({
  tunnelId: z.string().min(1).max(64),
  webhookId: z.string().uuid(),
});

export type WebhookParam = z.infer<typeof WebhookParamSchema>;

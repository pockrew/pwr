import { z } from "zod";

export const ApiKeySchema = z.strictObject({
  id: z.string().uuid(),
  orgId: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  keyPrefix: z.string().min(4).max(16),
  createdAt: z.number().int().positive(),
  revokedAt: z.number().int().positive().optional(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

export const TenantTierSchema = z.enum(["community", "pro", "enterprise"]);
export type TenantTier = z.infer<typeof TenantTierSchema>;
export const TenantTiers = TenantTierSchema.enum;

export const TenantContextSchema = z.strictObject({
  orgId: z.string().min(1).max(64),
  userId: z.string().optional(),
  apiKeyId: z.string().optional(),
  tier: TenantTierSchema.default("community"),
});

export type TenantContext = z.infer<typeof TenantContextSchema>;

export const CreateApiKeyInputSchema = z.strictObject({
  name: z.string().min(1).max(100).default("Default Key"),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

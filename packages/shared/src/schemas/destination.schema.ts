import { z } from "zod";

import { HttpMethodSchema } from "./webhook.schema";

export const FanoutFilterRuleSchema = z.strictObject({
  methods: z.array(HttpMethodSchema).optional(),
  pathContains: z.string().optional(),
  pathPrefix: z.string().optional(),
  headerMatches: z.record(z.string(), z.string()).optional(),
  headerExists: z.array(z.string()).optional(),
  jsonMatches: z.record(z.string(), z.unknown()).optional(),
});

export type FanoutFilterRule = z.infer<typeof FanoutFilterRuleSchema>;

export const FanoutDestinationSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100).optional(),
  targetUrl: z.url(),
  enabled: z.boolean().default(true),
  filter: FanoutFilterRuleSchema.optional(),
  rateLimit: z.number().positive().optional(),
});

export type FanoutDestination = z.infer<typeof FanoutDestinationSchema>;

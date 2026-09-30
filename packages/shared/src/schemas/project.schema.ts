import { z } from "zod";

export const RetentionConfigSchema = z.strictObject({
  maxEvents: z.number().int().positive().default(1000),
  retentionDays: z.number().int().positive().default(7),
  maxDbSizeMb: z.number().int().positive().default(512),
  autoVacuum: z.boolean().default(true),
});

export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;

export const ProxyModeSchema = z.enum(["auto", "manual", "disabled"]);
export type ProxyMode = z.infer<typeof ProxyModeSchema>;
export const ProxyModes = ProxyModeSchema.enum;

export const ProxyConfigSchema = z.strictObject({
  mode: ProxyModeSchema.default("auto"),
  httpProxy: z.string().optional(),
  httpsProxy: z.string().optional(),
  noProxy: z.string().default("localhost,127.0.0.1,::1"),
  caCertPath: z.string().optional(),
});

export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

export const ProjectConfigSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
  cluster: z.string().min(1).max(64).default("default-cluster"),
  defaultTarget: z.url().default("http://localhost:3000"),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const MaintenanceActionSchema = z.enum(["clean", "sync"]);
export type MaintenanceAction = z.infer<typeof MaintenanceActionSchema>;
export const MaintenanceActions = MaintenanceActionSchema.enum;

export const MaintenanceActionInputSchema = z
  .strictObject({
    action: MaintenanceActionSchema,
    days: z.number().int().positive().optional(),
    projects: z.array(z.string().min(1).max(64)).max(3).optional(),
    all: z.boolean().default(false),
    confirmToken: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.all) {
        return true;
      }
      return (data.projects && data.projects.length > 0) || Boolean(data.days);
    },
    {
      message:
        "Must specify at least one project (max 3), a days constraint, or explicitly choose 'all'.",
    },
  );

export type MaintenanceActionInput = z.infer<typeof MaintenanceActionInputSchema>;

export const MaintenanceActionResultSchema = z.strictObject({
  action: MaintenanceActionSchema,
  affectedProjects: z.array(z.string()),
  processedCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative().optional(),
  syncedCount: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative(),
  warningMessage: z.string().optional(),
});

export type MaintenanceActionResult = z.infer<typeof MaintenanceActionResultSchema>;

export const DatabaseStatusResponseSchema = z.strictObject({
  provider: z.literal("sqlite"),
  isHealthy: z.boolean(),
  sqlitePath: z.string(),
});

export type DatabaseStatusResponse = z.infer<typeof DatabaseStatusResponseSchema>;

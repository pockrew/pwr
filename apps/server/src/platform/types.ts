// @server-only
import type { Env } from "hono";

import type { ManagementPermission, SigningProvider } from "@pockrew/pwr-shared/schemas";

export interface Actor {
  id: string;
  types: "provider" | "agents" | "cli" | "admin";
  tenantId?: string;
  tunnelId?: string;
  permissions?: ManagementPermission[];
  keyName?: string;
}

export interface AppEnv extends Env {
  Variables: {
    requestId: string;
    actor: Actor;
    /** The tunnel's signed-ingress mode (secret still encrypted); absent in API-key mode. */
    ingressSigning?: { provider: SigningProvider; encryptedSecret: string; options: string | null };
  };
}

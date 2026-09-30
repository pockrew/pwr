import { getLogger } from "@logtape/logtape";
import { db } from "@server/db/client";
import * as authSchema from "@server/db/schemas/auth";
import { env } from "@server/platform/env";
import { forbiddenError } from "@server/platform/error.handlers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";

const isConfiguredUser = (email: string) => {
  if (env.ADMIN_EMAIL.toLowerCase() !== email.toLowerCase()) {
    throw forbiddenError("Only configured users can login");
  }
};

const devOrigins =
  env.NODE_ENV === "development"
    ? [
        "http://localhost:15175",
        "http://127.0.0.1:15175",
        "http://localhost:15174",
        "http://127.0.0.1:15174",
      ]
    : [];

const authLogger = getLogger(["pwr", "server", "auth"]);
const AUTH_LOG_LEVELS = { debug: "debug", info: "info", warn: "warning", error: "error" } as const;

/** Server-set header carrying the verified client IP (see auth routes); never client-supplied. */
export const AUTH_CLIENT_IP_HEADER = "x-pwr-client-ip";

export const auth = betterAuth({
  baseURL: env.PUBLIC_URL,
  advanced: { ipAddress: { ipAddressHeaders: [AUTH_CLIENT_IP_HEADER] } },
  trustedOrigins: devOrigins,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
  emailAndPassword: { enabled: true, autoSignIn: false },
  // Only local initialization calls signUpEmail; HTTP sign-up is disabled.
  disabledPaths: ["/sign-up/email"],
  session: { cookieCache: { enabled: false } },
  // Into server.log like everything else; only the message, never the extra arguments (users,
  // sessions or errors that can carry credentials).
  logger: {
    level: "warn",
    log: (level, message) => authLogger[AUTH_LOG_LEVELS[level]](message),
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "admin", input: false },
      orgId: { type: "string", required: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (usr) => {
          isConfiguredUser(usr.email);
          return { data: usr };
        },
      },
    },
    session: {
      create: {
        before: async (ses) => {
          const [record] = await db
            .select({ email: authSchema.user.email })
            .from(authSchema.user)
            .where(eq(authSchema.user.id, ses.userId))
            .limit(1);
          isConfiguredUser(record?.email ?? "");
          return { data: ses };
        },
      },
    },
  },
});

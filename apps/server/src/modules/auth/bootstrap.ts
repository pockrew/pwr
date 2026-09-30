import { db } from "@server/db/client";
import { account, user } from "@server/db/schemas/auth";
import { seedConfig } from "@server/db/seed.config";
import { env } from "@server/platform/env";
import { and, eq, isNotNull } from "drizzle-orm";

import { auth } from "./configs";

/** Create the sole configured account before accepting requests; restarts never reset its password. */
export const ensureAdminAccount = async (): Promise<void> => {
  const users = db.select().from(user).limit(2).all();
  if (users.length === 0) {
    if (!env.ADMIN_PASSWORD)
      throw new Error("ADMIN_PASSWORD is required to initialize a fresh auth database");
    // The internal API runs the normal Better Auth credential hooks while HTTP sign-up stays disabled.
    await auth.api.signUpEmail({
      body: { name: seedConfig.admin.name, email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    return;
  }
  const admin = users[0];
  if (
    users.length !== 1 ||
    !admin ||
    admin.email.toLowerCase() !== env.ADMIN_EMAIL ||
    admin.role !== "admin" ||
    !db
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, admin.id),
          eq(account.providerId, "credential"),
          isNotNull(account.password),
        ),
      )
      .limit(1)
      .get()
  )
    throw new Error("Configured admin account does not match the existing auth database");
};

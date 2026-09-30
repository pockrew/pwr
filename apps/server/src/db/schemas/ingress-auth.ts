import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { SigningProvider } from "@pockrew/pwr-shared/schemas";

import { tunnels } from "./tunnels";

/** One signed-provider mode per tunnel; absence keeps the existing API-key mode. */
export const ingressSigning = sqliteTable("ingress_signing", {
  tunnelId: text("tunnel_id")
    .primaryKey()
    .references(() => tunnels.id, { onDelete: "cascade" }),
  provider: text("provider", {
    enum: ["github", "stripe", "standard_webhooks", "shopify", "slack", "hmac"] satisfies [
      SigningProvider,
      ...SigningProvider[],
    ],
  }).notNull(),
  encryptedSecret: text("encrypted_secret").notNull(),
  /** Non-secret JSON options of the generic `hmac` scheme (header, algorithm, encoding, prefix). */
  options: text("options"),
});

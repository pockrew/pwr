import { db } from "@server/db/client";
import { server_settings } from "@server/db/schemas";
import { eq } from "drizzle-orm";

/** Saved JSON document for a settings key, if any. */
export const readSetting = (key: string): string | undefined =>
  db
    .select({ value: server_settings.value })
    .from(server_settings)
    .where(eq(server_settings.key, key))
    .get()?.value;

/** Insert or replace the JSON document for a settings key. */
export const writeSetting = (key: string, value: string): void => {
  db.insert(server_settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: server_settings.key, set: { value, updatedAt: new Date() } })
    .run();
};

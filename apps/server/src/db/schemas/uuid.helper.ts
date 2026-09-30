// @server-only
import { text } from "drizzle-orm/sqlite-core";

/**
 * Generates a pseudo-random alphanumeric string of specified length.
 *
 * @param length - Desired character count (defaults to 12).
 * @returns Random alphanumeric identifier string.
 */
const generateUniqueString = (length = 12): string => {
  // 1. Define character dictionary
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let uniqueString = "";

  // 2. Select pseudo-random characters up to requested length
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    uniqueString += characters[randomIndex];
  }

  // 3. Return constructed random string
  return uniqueString;
};

/**
 * Creates a primary key text column in Drizzle with a generated random alphanumeric default.
 *
 * @param key - Column name attribute.
 * @returns Configured Drizzle SQLite primary key column builder.
 */
export const uuid = (key: string) => {
  return text(key)
    .$defaultFn(() => generateUniqueString())
    .primaryKey();
};

// @server-only
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

import { validationError } from "./error.handlers";

const baseValidation = <Target extends keyof ValidationTargets, T extends ZodType>(
  type: Target,
  schema: T,
  message = "Invalid request",
) =>
  zValidator(type, schema, (result) => {
    if (!result.success) throw validationError(message);
  });

/**
 * Hono middleware validating incoming JSON request bodies against a Zod schema.
 *
 * @param schema - Zod schema to validate body against.
 * @param message - Custom validation failure error message.
 * @returns Hono middleware handler.
 */
export const requireBodyValidation = <T extends ZodType>(schema: T, message = "Invalid request") =>
  baseValidation("json", schema, message);

/**
 * Hono middleware validating incoming URL query parameters against a Zod schema.
 *
 * @param schema - Zod schema to validate query parameters against.
 * @param message - Custom validation failure error message.
 * @returns Hono middleware handler.
 */
export const requireQueryValidation = <T extends ZodType>(schema: T, message = "Invalid request") =>
  baseValidation("query", schema, message);

/**
 * Hono middleware validating incoming URL route parameters against a Zod schema.
 *
 * @param schema - Zod schema to validate route parameters against.
 * @param message - Custom validation failure error message.
 * @returns Hono middleware handler.
 */
export const requireParamValidation = <T extends ZodType>(schema: T, message = "Invalid request") =>
  baseValidation("param", schema, message);

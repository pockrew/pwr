import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";

/**
 * Validate a local API request before the relay service sees it, preserving the local error envelope.
 * @param target - JSON body, route parameters or query string.
 * @param schema - Canonical shared request schema.
 * @returns Typed Hono middleware; invalid input reaches the global error handler.
 */
export const requireValidation = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) throw new HTTPException(400);
  });

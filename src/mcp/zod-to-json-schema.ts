/**
 * Tool input schema → JSON Schema (draft-07) for MCP tools/list.
 *
 * Thin wrapper around zod v4's built-in `z.toJSONSchema()`. Uses
 * `io: 'input'` so fields with defaults are not marked required —
 * matches MCP client expectations (clients don't have to send a
 * value for a field that has a server-side default).
 */
import { type ZodTypeAny, z } from "zod";

type Schema = Record<string, unknown>;

export function zodToJsonSchema(schema: ZodTypeAny): Schema {
  return z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Schema;
}

// keep z from being tree-shaken when unused at the import site
export const _z = z;

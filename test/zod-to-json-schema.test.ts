/**
 * Schema converter unit tests — pure functions.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "../src/mcp/zod-to-json-schema.ts";

describe("zodToJsonSchema", () => {
  it("converts a typical tool input schema", () => {
    const schema = z.object({
      patient_id: z.string().optional(),
      count: z.number().int().min(1).max(250).default(25),
      active_only: z.boolean().default(true),
      gender: z.enum(["male", "female", "other"]).optional(),
    });
    const out = zodToJsonSchema(schema) as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(out.type).toBe("object");
    expect((out.properties.patient_id as { type: string }).type).toBe("string");
    expect(
      out.properties.count as { type: string; minimum: number; maximum: number; default: number },
    ).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 250,
      default: 25,
    });
    expect((out.properties.gender as { enum: string[] }).enum).toEqual(["male", "female", "other"]);
    // No required keys — all optional or have defaults
    expect(out.required ?? []).toEqual([]);
  });

  it("marks required fields", () => {
    const schema = z.object({ resource_type: z.string(), resource_id: z.string() });
    const out = zodToJsonSchema(schema) as { required?: string[] };
    expect(out.required?.sort()).toEqual(["resource_id", "resource_type"]);
  });
});

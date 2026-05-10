/**
 * Minimal Zod → JSON Schema converter for tool input schemas.
 * Covers the shapes our tools actually use: object, string, number,
 * boolean, enum, array, optional, default, nullable, literal.
 *
 * Outputs draft-07-ish schemas — what MCP clients expect.
 */
import { type ZodTypeAny, z } from "zod";

type Schema = Record<string, unknown>;

export function zodToJsonSchema(schema: ZodTypeAny): Schema {
  return convert(schema);
}

function convert(schema: ZodTypeAny): Schema {
  const def = (schema as { _def: { typeName: string } })._def;

  switch (def.typeName) {
    case "ZodString": {
      const s: Schema = { type: "string" };
      const checks =
        (def as unknown as { checks?: { kind: string; value?: unknown }[] }).checks ?? [];
      for (const c of checks) {
        if (c.kind === "min" && typeof c.value === "number") s.minLength = c.value;
        if (c.kind === "max" && typeof c.value === "number") s.maxLength = c.value;
      }
      return s;
    }
    case "ZodNumber": {
      const s: Schema = { type: "number" };
      const checks =
        (def as unknown as { checks?: { kind: string; value?: unknown; inclusive?: boolean }[] })
          .checks ?? [];
      let isInt = false;
      for (const c of checks) {
        if (c.kind === "int") isInt = true;
        if (c.kind === "min" && typeof c.value === "number") s.minimum = c.value;
        if (c.kind === "max" && typeof c.value === "number") s.maximum = c.value;
      }
      if (isInt) s.type = "integer";
      return s;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { const: (def as unknown as { value: unknown }).value };
    case "ZodEnum":
      return { type: "string", enum: (def as unknown as { values: string[] }).values };
    case "ZodArray":
      return {
        type: "array",
        items: convert((def as unknown as { type: ZodTypeAny }).type),
      };
    case "ZodObject": {
      const shape = (def as unknown as { shape: () => Record<string, ZodTypeAny> }).shape();
      const properties: Record<string, Schema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const inner = unwrap(value);
        properties[key] = convert(inner.schema);
        if (inner.description) (properties[key] as Schema).description = inner.description;
        if (inner.default !== undefined) (properties[key] as Schema).default = inner.default;
        if (!inner.optional) required.push(key);
      }
      const out: Schema = { type: "object", properties };
      if (required.length) out.required = required;
      return out;
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return convert((def as unknown as { innerType: ZodTypeAny }).innerType);
    case "ZodUnion": {
      const opts = (def as unknown as { options: ZodTypeAny[] }).options;
      return { anyOf: opts.map(convert) };
    }
    case "ZodRecord":
      return {
        type: "object",
        additionalProperties: convert((def as unknown as { valueType: ZodTypeAny }).valueType),
      };
    case "ZodAny":
    case "ZodUnknown":
      return {};
    default:
      return {};
  }
}

function unwrap(schema: ZodTypeAny): {
  schema: ZodTypeAny;
  optional: boolean;
  default?: unknown;
  description?: string;
} {
  let s: ZodTypeAny = schema;
  let optional = false;
  let defaultValue: unknown;
  const description = (s as unknown as { description?: string }).description;

  while (true) {
    const tn = (s as { _def: { typeName: string } })._def.typeName;
    if (tn === "ZodOptional") {
      optional = true;
      s = (s as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType;
    } else if (tn === "ZodDefault") {
      const d = (s as unknown as { _def: { defaultValue: () => unknown; innerType: ZodTypeAny } })
        ._def;
      defaultValue = d.defaultValue();
      optional = true;
      s = d.innerType;
    } else if (tn === "ZodNullable") {
      s = (s as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType;
    } else {
      break;
    }
  }
  return { schema: s, optional, default: defaultValue, description };
}

// keep z from being tree-shaken when unused at the import site
export const _z = z;

/**
 * Zod schemas for the `clinical_pack_visit_context` tool.
 *
 * Two schemas:
 *   - `visitContextInputSchema`  — tool input (registered with MCP, surfaced
 *                                  via `tools/list` JSON Schema). Restricted
 *                                  to the zod subset supported by
 *                                  `src/mcp/zod-to-json-schema.ts`.
 *   - `visitContextOutputSchema` — typed envelope returned by the tool. Used
 *                                  for `z.infer` and for shape-checking in
 *                                  vitest. Snake_case throughout, mirrors
 *                                  HERO_PATIENT.md §7 verbatim.
 */
import { z } from "zod";

// --------- input ---------

export const visitContextInputSchema = z.object({
  patient_id: z
    .string()
    .optional()
    .describe("FHIR Patient logical id. Falls back to JWT `patient` claim or X-Patient-ID header."),
  encounter_id: z
    .string()
    .optional()
    .describe("Specific FHIR Encounter to pack. If omitted, the most recent encounter is used."),
  language: z
    .string()
    .optional()
    .describe(
      "BCP-47 override for `patient.preferred_language` (e.g. `es-US`, `en-US`). " +
        "If omitted, derived from Patient.communication where preferred=true.",
    ),
});

export type VisitContextInput = z.infer<typeof visitContextInputSchema>;

// --------- output ---------

const patientShape = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().nullable(),
  preferred_language: z.string().nullable(),
  reading_level_target: z.string().nullable(),
});

const encounterShape = z.object({
  id: z.string(),
  date: z.string(),
  type: z.string().nullable(),
  provider: z.string().nullable(),
  reason: z.string().nullable(),
});

const activeProblemShape = z.object({
  display: z.string(),
  icd10: z.string().nullable().optional(),
  snomed: z.string().nullable().optional(),
  nyha: z.string().optional(),
  last_a1c: z.number().optional(),
  egfr: z.number().optional(),
});

const medicationChangeShape = z.object({
  action: z.enum(["new", "continue"]),
  name: z.string(),
  dose: z.string(),
  reason: z.string().optional(),
  behavior_rule: z.string().optional(),
  authored_on: z.string().nullable().optional(),
});

const orderShape = z.object({
  type: z.enum(["lab", "imaging", "appointment", "other"]),
  display: z.string(),
  timing: z.string().nullable(),
});

const vitalsTodayShape = z.object({
  bp: z.string().optional(),
  hr: z.number().optional(),
  weight_change_kg: z.number().optional(),
  weight_kg: z.number().optional(),
});

const keyLabsShape = z.object({
  egfr: z.number().optional(),
  k: z.number().optional(),
  a1c: z.number().optional(),
});

export const visitContextOutputSchema = z.object({
  patient: patientShape,
  encounter: encounterShape,
  active_problems: z.array(activeProblemShape),
  medication_changes: z.array(medicationChangeShape),
  orders: z.array(orderShape),
  vitals_today: vitalsTodayShape,
  key_labs_recent: keyLabsShape,
  caregiver_present: z.string().optional(),
  clinician_summary: z.string().optional(),
});

export type VisitContext = z.infer<typeof visitContextOutputSchema>;

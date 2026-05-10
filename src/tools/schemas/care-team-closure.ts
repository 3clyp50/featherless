import { z } from "zod";
import { visitContextOutputSchema } from "./visit-context.ts";

export const careTeamClosureInputSchema = z.object({
  visit_context: visitContextOutputSchema.describe(
    "Typed visit context produced by clinical_pack_visit_context.",
  ),
  patient_packet_markdown: z
    .string()
    .optional()
    .describe("Patient packet markdown to attach as a DocumentReference."),
  write_back: z
    .boolean()
    .default(false)
    .describe("Request PUT write-back. Requires WRITE_BACK=1 in Worker env."),
});

export type CareTeamClosureInput = z.infer<typeof careTeamClosureInputSchema>;

const validationResultShape = z.object({
  resource_type: z.string(),
  id: z.string(),
  ok: z.boolean(),
  issue_count: z.number(),
  status_code: z.number().optional(),
  message: z.string().optional(),
});

const writeResultShape = z.object({
  resource_type: z.string(),
  id: z.string(),
  ok: z.boolean(),
  status_code: z.number().optional(),
  location: z.string().optional(),
  message: z.string().optional(),
});

export const careTeamClosureOutputSchema = z.object({
  patient_id: z.string(),
  encounter_id: z.string(),
  generated_at: z.string(),
  write_back_requested: z.boolean(),
  write_back_enabled: z.boolean(),
  resources: z.array(z.record(z.string(), z.unknown())),
  validation_results: z.array(validationResultShape),
  write_results: z.array(writeResultShape).optional(),
});

export type CareTeamClosureOutput = z.infer<typeof careTeamClosureOutputSchema>;

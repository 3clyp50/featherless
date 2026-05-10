import { z } from "zod";
import { visitContextOutputSchema } from "./visit-context.ts";

export const patientPacketInputSchema = z.object({
  visit_context: visitContextOutputSchema.describe(
    "Typed visit context produced by clinical_pack_visit_context.",
  ),
  language: z
    .string()
    .optional()
    .describe(
      "BCP-47 output language override. Defaults to visit_context.patient.preferred_language.",
    ),
  reading_level_target: z
    .string()
    .optional()
    .describe(
      "Reading-level target override. Defaults to visit_context.patient.reading_level_target.",
    ),
  citation_ids: z
    .array(z.string())
    .optional()
    .describe("Allowed citation IDs. Defaults to the Featherless patient-education allow-list."),
});

export type PatientPacketInput = z.infer<typeof patientPacketInputSchema>;

const medicationLineShape = z.object({
  action: z.enum(["new", "continue"]),
  name: z.string(),
  dose: z.string(),
  instructions: z.string().optional(),
  why: z.string().optional(),
});

const packetSectionsShape = z.object({
  what_we_did_today: z.string(),
  medications: z.array(medicationLineShape),
  watch_for: z.array(z.string()),
  next_steps: z.array(z.string()),
  when_to_call: z.array(z.string()),
  when_to_go_to_er: z.array(z.string()),
  citations_footer: z.string(),
});

export const generatedPatientPacketSchema = z.object({
  language: z.string(),
  reading_level_target: z.string(),
  title: z.string(),
  sections: packetSectionsShape,
  citations_used: z.array(z.string()),
});

export type GeneratedPatientPacket = z.infer<typeof generatedPatientPacketSchema>;

const readabilityShape = z.object({
  flesch_kincaid_grade: z.number(),
  inflesz_score: z.number(),
  word_count: z.number(),
  sentence_count: z.number(),
  target: z.string(),
  meets_target: z.boolean(),
});

const groundingShape = z.object({
  ok: z.boolean(),
  citations_used: z.array(z.string()),
  unapproved_citations: z.array(z.string()),
  unsupported_quotes: z.array(z.string()),
  unknown_doses: z.array(z.string()),
});

export const patientPacketOutputSchema = generatedPatientPacketSchema.extend({
  packet_markdown: z.string(),
  readability: readabilityShape,
  grounding: groundingShape,
  provider: z.string(),
  model: z.string(),
  generated_at: z.string(),
});

export type PatientPacketOutput = z.infer<typeof patientPacketOutputSchema>;

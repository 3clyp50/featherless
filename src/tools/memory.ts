/**
 * Optional clinical memory tools backed by Cloudflare Vectorize + Workers AI + D1.
 *
 * No-op when memory bindings aren't configured (Python parity:
 * `register_memory_tools(mcp, None)` is a no-op).
 */
import { z } from "zod";
import type { McpServer } from "../mcp/server.ts";
import type { MemoryClient } from "../clients/memory-client.ts";
import { FHIRError } from "../clients/fhir-client.ts";
import { patientDisplayName } from "../fhir-utils.ts";
import {
  checkFhirContext,
  fhirClientForCurrentContext,
  resolvePatientId,
} from "./_helpers.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

async function patientName(pid: string): Promise<string> {
  try {
    const fhir = fhirClientForCurrentContext();
    const patient = await fhir.getPatient(pid);
    return patientDisplayName(patient);
  } catch (e) {
    if (e instanceof FHIRError) return "";
    return "";
  }
}

export function registerMemoryTools(server: McpServer, memory: MemoryClient | null): void {
  if (!memory) return;

  server.tool(
    "memory_store_encounter",
    "Store a clinical encounter summary for cross-session recall (extracted into atomic facts and indexed).",
    z.object({
      encounter_summary: z.string(),
      visit_date: z.string().describe("YYYY-MM-DD"),
      chief_complaint: z.string().optional(),
      diagnosis: z.string().optional(),
      plan: z.string().optional(),
      practitioner_name: z.string().optional(),
      patient_id: z.string().optional(),
      source_encounter: z.string().optional().describe("Optional FHIR Encounter id for provenance"),
    }),
    async (args) => {
      const err = checkFhirContext({ requirePatient: true, patientId: args.patient_id });
      if (err) return err;
      const pid = resolvePatientId(args.patient_id) ?? "";
      const name = (await patientName(pid)) || pid;

      const parts = [`Encounter for ${name} (FHIR Patient/${pid}) on ${args.visit_date}.`];
      if (args.practitioner_name) parts.push(`Provider: ${args.practitioner_name}.`);
      if (args.chief_complaint) parts.push(`Chief complaint: ${args.chief_complaint}.`);
      if (args.diagnosis) parts.push(`Diagnosis: ${args.diagnosis}.`);
      if (args.plan) parts.push(`Plan: ${args.plan}.`);
      parts.push(`Summary: ${args.encounter_summary}`);

      try {
        const result = await memory.addFact(pid, parts.join("\n"), {
          factType: "encounter",
          sourceEncounter: args.source_encounter ?? null,
          extra: { visit_date: args.visit_date, patient_name: name },
        });
        return {
          success: true,
          patient_id: pid,
          patient_name: name,
          visit_date: args.visit_date,
          ids: result.ids,
          facts: result.facts,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  server.tool(
    "memory_store_alert",
    "Store a persistent clinical alert/flag for the patient.",
    z.object({
      alert_type: z.string().describe("allergy | drug_interaction | lab_critical | patient_preference | behavioral | follow_up | other"),
      alert_content: z.string(),
      severity: z.enum(["info", "warning", "critical"]).default("warning"),
      patient_id: z.string().optional(),
    }),
    async ({ alert_type, alert_content, severity, patient_id }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      const name = (await patientName(pid)) || pid;
      const text = `CLINICAL ALERT [${severity.toUpperCase()}] for ${name} (FHIR Patient/${pid}). Type: ${alert_type}. ${alert_content}`;
      try {
        const result = await memory.addFact(pid, text, {
          factType: "alert",
          extra: { alert_type, severity, patient_name: name },
        });
        return {
          success: true,
          patient_id: pid,
          alert_type,
          severity,
          ids: result.ids,
          facts: result.facts,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  server.tool(
    "memory_store_note",
    "Store a free-text clinical note tagged to the patient. Use for notes derived from non-text inputs (radiology read summaries, audio-dictation transcripts, video-clip descriptions). The agent host is responsible for VLM/Whisper/etc pre-processing — this tool only persists text.",
    z.object({
      note: z.string(),
      note_type: z.string().default("general").describe("radiology | transcript | video_summary | general | ..."),
      patient_id: z.string().optional(),
    }),
    async ({ note, note_type, patient_id }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const result = await memory.addFact(pid, `Note (${note_type}) for FHIR Patient/${pid}: ${note}`, {
          factType: note_type,
        });
        return { success: true, patient_id: pid, ids: result.ids, facts: result.facts };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  server.tool(
    "memory_search_history",
    "Semantic search across the patient's clinical memory.",
    z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(50).default(10),
      patient_id: z.string().optional(),
    }),
    async ({ query, limit, patient_id }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const results = await memory.search(pid, query, clamp(limit, 1, 50));
        return { patient_id: pid, query, results };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  server.tool(
    "memory_get_patient_history",
    "Return all stored memories for the patient.",
    z.object({
      patient_id: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    async ({ patient_id, limit }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const memories = await memory.getAll(pid, clamp(limit, 1, 200));
        return { patient_id: pid, memories };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  server.tool(
    "memory_delete",
    "Delete a single memory by id.",
    z.object({ memory_id: z.string() }),
    async ({ memory_id }) => {
      try {
        const result = await memory.delete(memory_id);
        return { success: true, memory_id, ...result };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  server.tool(
    "memory_reset_patient",
    "Wipe all stored memories for one patient. Irreversible.",
    z.object({ patient_id: z.string().optional() }),
    async ({ patient_id }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const result = await memory.deleteAll(pid);
        return { success: true, patient_id: pid, ...result };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );
}

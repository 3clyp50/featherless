/**
 * Clinical FHIR tools — patient demographics, encounters, appointments,
 * problems, medications, allergies, immunizations.
 *
 * All read-only. Compact summaries via `fhir-utils`.
 */
import { z } from "zod";
import { FHIRError } from "../clients/fhir-client.ts";
import {
  allergySummary,
  appointmentSummary,
  bundleNextLink,
  bundleToResources,
  bundleTotal,
  conditionSummary,
  encounterSummary,
  immunizationSummary,
  medicationRequestSummary,
  patientSummary,
} from "../fhir-utils.ts";
import type { McpServer } from "../mcp/server.ts";
import { checkFhirContext, fhirClientForCurrentContext, resolvePatientId } from "./_helpers.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function registerClinicalTools(server: McpServer): void {
  // ====
  // Patient
  // ====

  server.tool(
    "clinical_search_patients",
    "Search for patients on the connected FHIR server. Provide at least one search field; combinations are AND-ed by the server.",
    z.object({
      name: z.string().optional(),
      family: z.string().optional(),
      given: z.string().optional(),
      birthdate: z.string().optional().describe("YYYY-MM-DD"),
      identifier: z.string().optional().describe("MRN or other patient identifier"),
      gender: z.string().optional().describe("male | female | other | unknown"),
      count: z.number().int().min(1).max(250).default(25),
    }),
    async (args) => {
      const err = checkFhirContext();
      if (err) return err;
      if (
        !args.name &&
        !args.family &&
        !args.given &&
        !args.birthdate &&
        !args.identifier &&
        !args.gender
      ) {
        return { error: "Provide at least one search field." };
      }
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.searchPatients({ ...args, count: clamp(args.count, 1, 250) });
        const patients = bundleToResources(bundle).map(patientSummary);
        return {
          patients,
          total_count: bundleTotal(bundle),
          returned: patients.length,
          has_more: bundleNextLink(bundle) !== null,
          next_link: bundleNextLink(bundle),
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "clinical_get_patient_summary",
    "Return a summary of a patient — demographics + recent encounters & appointments.",
    z.object({ patient_id: z.string().optional() }),
    async ({ patient_id }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const [patient, encountersBundle, appointmentsBundle] = await Promise.all([
          fhir.getPatient(pid),
          fhir.getEncounters(pid, { count: 5 }),
          fhir.getAppointments(pid, { count: 5 }),
        ]);
        return {
          ...patientSummary(patient),
          recent_encounters: bundleToResources(encountersBundle).map(encounterSummary),
          recent_appointments: bundleToResources(appointmentsBundle).map(appointmentSummary),
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  // ====
  // Appointments / Encounters
  // ====

  server.tool(
    "clinical_get_appointments",
    "Search FHIR Appointment resources.",
    z.object({
      patient_id: z.string().optional(),
      date: z.string().optional().describe("FHIR date filter, e.g. ge2025-01-01"),
      status: z
        .string()
        .optional()
        .describe("Appointment status: booked, arrived, fulfilled, cancelled, ..."),
      count: z.number().int().min(1).max(250).default(25),
    }),
    async ({ patient_id, date, status, count }) => {
      const err = checkFhirContext();
      if (err) return err;
      const pid = resolvePatientId(patient_id);
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getAppointments(pid, {
          date,
          status,
          count: clamp(count, 1, 250),
        });
        const appointments = bundleToResources(bundle).map(appointmentSummary);
        return {
          appointments,
          total_count: bundleTotal(bundle),
          returned: appointments.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "clinical_get_encounters",
    "Search FHIR Encounter resources for a patient.",
    z.object({
      patient_id: z.string().optional(),
      date: z.string().optional().describe("FHIR date filter, e.g. ge2024-01-01"),
      status: z
        .string()
        .optional()
        .describe("planned | arrived | in-progress | finished | cancelled | ..."),
      count: z.number().int().min(1).max(250).default(25),
    }),
    async ({ patient_id, date, status, count }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getEncounters(pid, { date, status, count: clamp(count, 1, 250) });
        const encounters = bundleToResources(bundle).map(encounterSummary);
        return {
          encounters,
          total_count: bundleTotal(bundle),
          returned: encounters.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  // ====
  // Conditions / Problems
  // ====

  server.tool(
    "clinical_get_problems",
    "Return the patient's problem list (FHIR Condition resources).",
    z.object({
      patient_id: z.string().optional(),
      active_only: z.boolean().default(true),
      count: z.number().int().min(1).max(250).default(50),
    }),
    async ({ patient_id, active_only, count }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getConditions(pid, {
          clinicalStatus: active_only ? "active" : undefined,
          count: clamp(count, 1, 250),
        });
        const problems = bundleToResources(bundle).map(conditionSummary);
        return {
          problems,
          total_count: bundleTotal(bundle),
          returned: problems.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  // ====
  // Medications
  // ====

  server.tool(
    "clinical_get_medications",
    "Return the patient's medications (FHIR MedicationRequest).",
    z.object({
      patient_id: z.string().optional(),
      status: z
        .string()
        .optional()
        .default("active")
        .describe("Pass empty string for all statuses"),
      count: z.number().int().min(1).max(250).default(50),
    }),
    async ({ patient_id, status, count }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getMedicationRequests(pid, {
          status: status || undefined,
          count: clamp(count, 1, 250),
        });
        const medications = bundleToResources(bundle).map(medicationRequestSummary);
        return {
          medications,
          total_count: bundleTotal(bundle),
          returned: medications.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  // ====
  // Allergies
  // ====

  server.tool(
    "clinical_get_allergies",
    "Return the patient's allergy & intolerance list.",
    z.object({
      patient_id: z.string().optional(),
      count: z.number().int().min(1).max(250).default(50),
    }),
    async ({ patient_id, count }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getAllergies(pid, { count: clamp(count, 1, 250) });
        const allergies = bundleToResources(bundle).map(allergySummary);
        return {
          allergies,
          total_count: bundleTotal(bundle),
          returned: allergies.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  // ====
  // Immunizations
  // ====

  server.tool(
    "clinical_get_immunizations",
    "Return the patient's immunization history.",
    z.object({
      patient_id: z.string().optional(),
      count: z.number().int().min(1).max(250).default(50),
    }),
    async ({ patient_id, count }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getImmunizations(pid, { count: clamp(count, 1, 250) });
        const immunizations = bundleToResources(bundle).map(immunizationSummary);
        return {
          immunizations,
          total_count: bundleTotal(bundle),
          returned: immunizations.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  // ====
  // Consolidated health record
  // ====

  server.tool(
    "clinical_get_health_record",
    "One-shot consolidated patient health record: active problems, active meds, allergies, immunizations.",
    z.object({ patient_id: z.string().optional() }),
    async ({ patient_id }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const [problemsB, medsB, allergiesB, immsB] = await Promise.all([
          fhir.getConditions(pid, { clinicalStatus: "active", count: 100 }),
          fhir.getMedicationRequests(pid, { status: "active", count: 100 }),
          fhir.getAllergies(pid, { count: 100 }),
          fhir.getImmunizations(pid, { count: 100 }),
        ]);
        const problems = bundleToResources(problemsB).map(conditionSummary);
        const medications = bundleToResources(medsB).map(medicationRequestSummary);
        const allergies = bundleToResources(allergiesB).map(allergySummary);
        const immunizations = bundleToResources(immsB).map(immunizationSummary);
        return {
          patient_id: pid,
          problems,
          medications,
          allergies,
          immunizations,
          counts: {
            problems: problems.length,
            medications: medications.length,
            allergies: allergies.length,
            immunizations: immunizations.length,
          },
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );
}

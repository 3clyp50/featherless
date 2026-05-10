/**
 * Lab results, vitals, diagnostic reports & imaging documents.
 * Wraps FHIR Observation, DiagnosticReport, DocumentReference.
 */
import { z } from "zod";
import { FHIRError } from "../clients/fhir-client.ts";
import {
  bundleNextLink,
  bundleToResources,
  bundleTotal,
  diagnosticReportSummary,
  documentReferenceSummary,
  observationSummary,
} from "../fhir-utils.ts";
import type { McpServer } from "../mcp/server.ts";
import { checkFhirContext, fhirClientForCurrentContext, resolvePatientId } from "./_helpers.ts";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function registerLabImagingTools(server: McpServer): void {
  server.tool(
    "lab_get_results",
    "Return laboratory results (FHIR Observation category=laboratory).",
    z.object({
      patient_id: z.string().optional(),
      code: z.string().optional().describe("LOINC or other code filter, e.g. 2339-0"),
      date: z.string().optional().describe("FHIR date filter, e.g. ge2024-01-01"),
      count: z.number().int().min(1).max(250).default(50),
      abnormal_only: z.boolean().default(false),
    }),
    async ({ patient_id, code, date, count, abnormal_only }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getObservations(pid, {
          category: "laboratory",
          code,
          date,
          count: clamp(count, 1, 250),
        });
        let labs = bundleToResources(bundle).map(observationSummary);
        if (abnormal_only) labs = labs.filter((l) => Boolean(l.abnormal));
        return {
          labs,
          total_count: bundleTotal(bundle),
          returned: labs.length,
          has_more: bundleNextLink(bundle) !== null,
          abnormal_count: labs.reduce((n, l) => n + (l.abnormal ? 1 : 0), 0),
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "lab_get_vital_signs",
    "Return vital sign observations (Observation category=vital-signs), grouped by test name.",
    z.object({
      patient_id: z.string().optional(),
      date: z.string().optional(),
      count: z.number().int().min(1).max(250).default(100),
    }),
    async ({ patient_id, date, count }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getObservations(pid, {
          category: "vital-signs",
          date,
          count: clamp(count, 1, 250),
        });
        const vitals = bundleToResources(bundle).map(observationSummary);
        const grouped: Record<string, Record<string, unknown>[]> = {};
        for (const v of vitals) {
          const key = (v.test as string) || "Unknown";
          grouped[key] ??= [];
          grouped[key].push(v);
        }
        return {
          vitals,
          by_type: grouped,
          types: Object.keys(grouped),
          total_count: bundleTotal(bundle),
          returned: vitals.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "lab_get_diagnostic_reports",
    "Return DiagnosticReport resources for the patient.",
    z.object({
      patient_id: z.string().optional(),
      category: z.string().optional().describe("LAB, RAD, PAT, CT, CG, ..."),
      date: z.string().optional(),
      count: z.number().int().min(1).max(250).default(25),
    }),
    async ({ patient_id, category, date, count }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getDiagnosticReports(pid, {
          category,
          date,
          count: clamp(count, 1, 250),
        });
        const reports = bundleToResources(bundle).map(diagnosticReportSummary);
        return {
          reports,
          total_count: bundleTotal(bundle),
          returned: reports.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );

  server.tool(
    "imaging_get_documents",
    "Return DocumentReference resources (clinical notes, imaging, scans).",
    z.object({
      patient_id: z.string().optional(),
      category: z.string().optional(),
      type_code: z.string().optional().describe("e.g. 18748-4 for diagnostic imaging"),
      count: z.number().int().min(1).max(250).default(25),
    }),
    async ({ patient_id, category, type_code, count }) => {
      const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
      if (err) return err;
      const pid = resolvePatientId(patient_id) ?? "";
      try {
        const fhir = fhirClientForCurrentContext();
        const bundle = await fhir.getDocumentReferences(pid, {
          category,
          type: type_code,
          count: clamp(count, 1, 250),
        });
        const documents = bundleToResources(bundle).map(documentReferenceSummary);
        return {
          documents,
          total_count: bundleTotal(bundle),
          returned: documents.length,
          has_more: bundleNextLink(bundle) !== null,
        };
      } catch (e) {
        if (e instanceof FHIRError) return e.toToolResponse();
        throw e;
      }
    },
  );
}

/**
 * Comprehensive clinical context for the current patient.
 *
 * Aggregates Patient + AllergyIntolerance + MedicationRequest + Condition +
 * Observation (labs & vitals) + Immunization + Encounter into a single
 * LLM-friendly response — including derived clinical alerts.
 *
 * The aggregation is split into a pure function (`aggregateClinicalContext`)
 * and a thin tool registration so that other in-process callers (notably the
 * visit-context packer) can compose the same aggregation without going
 * over HTTP.
 */
import { z } from "zod";
import { FHIRError } from "../clients/fhir-client.ts";
import {
  allergySummary,
  bundleToResources,
  conditionSummary,
  encounterSummary,
  immunizationSummary,
  medicationRequestSummary,
  observationSummary,
  patientSummary,
} from "../fhir-utils.ts";
import type { McpServer } from "../mcp/server.ts";
import { checkFhirContext, fhirClientForCurrentContext, resolvePatientId } from "./_helpers.ts";
import type { ContextErrorEnvelope } from "./_helpers.ts";

type Dict = Record<string, unknown>;

function daysAgoIso(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function safeResources<T>(value: PromiseSettledResult<T>): Dict[] {
  if (value.status !== "fulfilled") return [];
  return bundleToResources(value.value as Dict);
}

function generateAlerts(allergies: Dict[], medications: Dict[], labs: Dict[]): Dict[] {
  const alerts: Dict[] = [];
  if (allergies.length) {
    const active = allergies.filter((a) => {
      const status = (a.clinical_status as string | null)?.toLowerCase() ?? "active";
      return status !== "resolved";
    });
    if (active.length) {
      alerts.push({
        type: "allergy_warning",
        severity: "high",
        message: `Patient has ${active.length} documented allergies`,
        details: active.map((a) => a.allergen).filter(Boolean),
      });
    }
  }
  const abnormal = labs.filter((l) => Boolean(l.abnormal));
  if (abnormal.length) {
    alerts.push({
      type: "abnormal_labs",
      severity: "medium",
      message: `${abnormal.length} abnormal lab results in look-back window`,
      details: abnormal.slice(0, 5).map((l) => `${l.test}: ${l.value} ${l.unit ?? ""}`.trim()),
    });
  }
  if (medications.length >= 10) {
    alerts.push({
      type: "polypharmacy",
      severity: "medium",
      message: `Patient on ${medications.length} active medications — review for interactions`,
    });
  }
  return alerts;
}

export interface AggregateClinicalContextOpts {
  patient_id?: string;
  lab_lookback_days?: number;
  vitals_lookback_days?: number;
  encounter_lookback_days?: number;
  include_alerts?: boolean;
}

export interface ClinicalContextAggregate {
  retrieved_at: string;
  patient_id: string;
  demographics: Dict;
  allergies: Dict[];
  active_medications: Dict[];
  active_problems: Dict[];
  immunizations: Dict[];
  recent_labs: Dict[];
  recent_vitals: Dict[];
  recent_encounters: Dict[];
  counts: {
    allergies: number;
    medications: number;
    problems: number;
    immunizations: number;
    labs: number;
    vitals: number;
    encounters: number;
  };
  alerts?: Dict[];
  partial_errors?: Record<string, string>;
}

/**
 * Pure aggregator — no MCP plumbing, no tool-response wrapping.
 * Returns either a successful aggregate or a context/FHIR error envelope.
 * Callers in-process (e.g. the visit-context packer) get a typed result;
 * the `clinical_get_context` tool registration just forwards the value.
 */
export async function aggregateClinicalContext(
  opts: AggregateClinicalContextOpts = {},
): Promise<ClinicalContextAggregate | ContextErrorEnvelope | Dict> {
  const {
    patient_id,
    lab_lookback_days = 90,
    vitals_lookback_days = 365,
    encounter_lookback_days = 365,
    include_alerts = true,
  } = opts;

  const err = checkFhirContext({ requirePatient: true, patientId: patient_id });
  if (err) return err;
  const pid = resolvePatientId(patient_id) ?? "";

  const labSince = daysAgoIso(lab_lookback_days);
  const vitalsSince = daysAgoIso(vitals_lookback_days);
  const encountersSince = daysAgoIso(encounter_lookback_days);

  let fhir: ReturnType<typeof fhirClientForCurrentContext>;
  try {
    fhir = fhirClientForCurrentContext();
  } catch (e) {
    if (e instanceof FHIRError) return e.toToolResponse();
    throw e;
  }

  const settled = await Promise.allSettled([
    fhir.getPatient(pid),
    fhir.getAllergies(pid, { count: 100 }),
    fhir.getMedicationRequests(pid, { status: "active", count: 100 }),
    fhir.getConditions(pid, { clinicalStatus: "active", count: 100 }),
    fhir.getImmunizations(pid, { count: 100 }),
    fhir.getObservations(pid, {
      category: "laboratory",
      date: `ge${labSince}`,
      count: 100,
    }),
    fhir.getObservations(pid, {
      category: "vital-signs",
      date: `ge${vitalsSince}`,
      count: 100,
    }),
    fhir.getEncounters(pid, { date: `ge${encountersSince}`, count: 10 }),
  ]);

  const [patientR, allergiesR, medsR, problemsR, immsR, labsR, vitalsR, encountersR] = settled;

  const patient = patientR.status === "fulfilled" ? (patientR.value as Dict) : {};
  const allergies = safeResources(allergiesR).map(allergySummary);
  const medications = safeResources(medsR).map(medicationRequestSummary);
  const problems = safeResources(problemsR).map(conditionSummary);
  const immunizations = safeResources(immsR).map(immunizationSummary);
  const labs = safeResources(labsR).map(observationSummary);
  const vitals = safeResources(vitalsR).map(observationSummary);
  const encounters = safeResources(encountersR).map(encounterSummary);

  const labels = [
    "patient",
    "allergies",
    "medications",
    "problems",
    "immunizations",
    "labs",
    "vitals",
    "encounters",
  ];
  const partialErrors: Record<string, string> = {};
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      const label = labels[i];
      if (label) {
        partialErrors[label] = r.reason instanceof Error ? r.reason.message : String(r.reason);
      }
    }
  });

  const context: ClinicalContextAggregate = {
    retrieved_at: new Date().toISOString(),
    patient_id: pid,
    demographics: Object.keys(patient).length ? patientSummary(patient) : {},
    allergies,
    active_medications: medications,
    active_problems: problems,
    immunizations,
    recent_labs: labs,
    recent_vitals: vitals,
    recent_encounters: encounters,
    counts: {
      allergies: allergies.length,
      medications: medications.length,
      problems: problems.length,
      immunizations: immunizations.length,
      labs: labs.length,
      vitals: vitals.length,
      encounters: encounters.length,
    },
  };

  if (include_alerts) {
    context.alerts = generateAlerts(allergies, medications, labs);
  }
  if (Object.keys(partialErrors).length) {
    context.partial_errors = partialErrors;
  }
  return context;
}

export function registerClinicalContextTools(server: McpServer): void {
  server.tool(
    "clinical_get_context",
    "Comprehensive clinical context for a patient visit. Pulls demographics, allergies, active meds, problems, immunizations, recent labs/vitals, and recent encounters in parallel; derives clinical alerts.",
    z.object({
      patient_id: z.string().optional(),
      lab_lookback_days: z.number().int().min(1).max(3650).default(90),
      vitals_lookback_days: z.number().int().min(1).max(3650).default(365),
      encounter_lookback_days: z.number().int().min(1).max(3650).default(365),
      include_alerts: z.boolean().default(true),
    }),
    async ({
      patient_id,
      lab_lookback_days,
      vitals_lookback_days,
      encounter_lookback_days,
      include_alerts,
    }) =>
      aggregateClinicalContext({
        patient_id,
        lab_lookback_days,
        vitals_lookback_days,
        encounter_lookback_days,
        include_alerts,
      }),
  );
}

import { type FHIRBundle, FHIRError } from "../clients/fhir-client.ts";
import { bundleToResources, codingText } from "../fhir-utils.ts";
/**
 * Visit-scoped clinical context packer — `clinical_pack_visit_context`.
 *
 * Composes the substrate's clinical-context aggregator, reusing its raw
 * Patient/Condition/MedicationRequest/Observation resources, with raw fetches
 * for ServiceRequest + Appointment + DocumentReference. Returns the typed
 * visit-context payload defined in `HERO_PATIENT.md` §7. Snake_case
 * throughout. No HTTP self-call — every dependency runs in-process under the
 * same SHARP context.
 *
 * Runs as a single MCP tool registration via `registerClinicalVisitContextTools(server)`,
 * which is wired into `src/server.ts` next to the substrate registrations.
 */
import type { McpServer } from "../mcp/server.ts";
import { checkFhirContext, fhirClientForCurrentContext, resolvePatientId } from "./_helpers.ts";
import { type ClinicalContextAggregate, aggregateClinicalContext } from "./clinical-context.ts";
import {
  type VisitContext,
  type VisitContextInput,
  visitContextInputSchema,
} from "./schemas/visit-context.ts";

type Dict = Record<string, unknown>;

const MS_PER_DAY = 86_400_000;
const VISIT_CONTEXT_RECENT_ENCOUNTER_LOOKBACK_DAYS = 90;
const VISIT_CONTEXT_FALLBACK_ENCOUNTER_LOOKBACK_DAYS = 3650;

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObj(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function firstSystemCode(concept: Dict, predicate: (system: string) => boolean): string | null {
  for (const c of asArr(concept.coding)) {
    const co = asObj(c);
    const sys = ((co.system as string) ?? "").toLowerCase();
    if (predicate(sys) && co.code) return String(co.code);
  }
  return null;
}

const firstIcd = (c: Dict): string | null =>
  firstSystemCode(c, (s) => s.includes("icd-10") || s.includes("icd-9"));
const firstSnomed = (c: Dict): string | null =>
  firstSystemCode(c, (s) => s === "http://snomed.info/sct");
const firstLoinc = (c: Dict): string | null => firstSystemCode(c, (s) => s === "http://loinc.org");

function preferredLanguageFromPatient(patient: Dict): string | null {
  for (const c of asArr(patient.communication)) {
    const co = asObj(c);
    if (co.preferred === true) {
      const lang = asObj(co.language);
      const code = firstSystemCode(lang, (s) => s === "urn:ietf:bcp:47" || s.includes("bcp"));
      if (code) return code;
      const text = lang.text;
      if (typeof text === "string" && text) return text;
    }
  }
  // Fallback: first communication entry's coded language.
  const first = asObj(asArr(patient.communication)[0]);
  if (Object.keys(first).length) {
    const lang = asObj(first.language);
    const code = firstSystemCode(lang, () => true);
    if (code) return code;
  }
  return null;
}

function readingLevelTargetFor(language: string | null): string | null {
  if (!language) return null;
  const tag = language.toLowerCase();
  if (tag.startsWith("es")) return "grade-6-es";
  if (tag.startsWith("en")) return "grade-6-en";
  return "grade-6-en";
}

function pickEncounter(encounters: Dict[], encounterId: string | undefined): Dict | null {
  if (encounterId) {
    return encounters.find((e) => (e.id as string | undefined) === encounterId) ?? null;
  }
  // Most recent by `start` (ISO sortable).
  const sorted = [...encounters].sort((a, b) => {
    const sa = (a.start as string | null) ?? "";
    const sb = (b.start as string | null) ?? "";
    return sb.localeCompare(sa);
  });
  return sorted[0] ?? null;
}

function aggregateVisitClinicalContext(
  patientId: string,
  encounterLookbackDays: number,
): ReturnType<typeof aggregateClinicalContext> {
  return aggregateClinicalContext({
    patient_id: patientId,
    lab_lookback_days: 365,
    vitals_lookback_days: 365,
    encounter_lookback_days: encounterLookbackDays,
    include_alerts: false,
    include_raw_resources: true,
  });
}

function encounterLookbackLabel(days: number): string {
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${days} day${days === 1 ? "" : "s"}`;
}

function encounterTypeSlug(rawEncounter: Dict, summaryType: string | null): string | null {
  const fromRaw = codingText(asObj(asArr(rawEncounter.type)[0])) || "";
  const text = fromRaw || summaryType || "";
  if (!text) return null;
  return text.trim().toLowerCase().replace(/\s+/g, "-");
}

function providerFromEncounter(rawEncounter: Dict): string | null {
  for (const p of asArr(rawEncounter.participant)) {
    const part = asObj(p);
    for (const t of asArr(part.type)) {
      for (const c of asArr(asObj(t).coding)) {
        if ((asObj(c).code as string) === "PPRF") {
          const ind = asObj(part.individual).display;
          if (typeof ind === "string" && ind) return ind;
        }
      }
    }
  }
  // Fallback: first participant with a display.
  for (const p of asArr(rawEncounter.participant)) {
    const ind = asObj(asObj(p).individual).display;
    if (typeof ind === "string" && ind) return ind;
  }
  return null;
}

function nyhaFromText(text: string): string | null {
  // Match "NYHA II", "NYHA III", "NYHA IV", etc.
  const m = /\bNYHA\s+(IV|III|II|I)\b/i.exec(text);
  const cls = m?.[1];
  return cls ? cls.toUpperCase() : null;
}

interface ProblemEnrichment {
  last_a1c?: number;
  egfr?: number;
  nyha?: string;
}

function enrichProblem(
  problemDisplay: string,
  rawConditionText: string,
  labs: Dict[],
): ProblemEnrichment {
  const out: ProblemEnrichment = {};
  const text = `${problemDisplay} ${rawConditionText}`;

  const nyha = nyhaFromText(text);
  if (nyha) out.nyha = nyha;

  if (/diabetes|t2dm|t1dm|\bdm\b/i.test(text)) {
    const a1c = mostRecentLabByLoinc(labs, "4548-4");
    if (a1c !== null) out.last_a1c = a1c;
  }
  if (/kidney|ckd|renal/i.test(text)) {
    const egfr = mostRecentLabByLoinc(labs, "33914-3");
    if (egfr !== null) out.egfr = egfr;
  }
  return out;
}

function mostRecentLabByLoinc(labs: Dict[], loinc: string): number | null {
  const matches = labs.filter((l) => l.loinc === loinc && typeof l.value === "number");
  matches.sort((a, b) => {
    const da = (a.date as string | null) ?? "";
    const db = (b.date as string | null) ?? "";
    return db.localeCompare(da);
  });
  const top = matches[0];
  return top ? ((top.value as number) ?? null) : null;
}

interface BpComponents {
  systolic: number | null;
  diastolic: number | null;
}

function bpFromObservation(obs: Dict): BpComponents {
  let systolic: number | null = null;
  let diastolic: number | null = null;
  for (const c of asArr(obs.component)) {
    const comp = asObj(c);
    const code = firstLoinc(asObj(comp.code));
    const value = asObj(comp.valueQuantity).value;
    if (typeof value !== "number") continue;
    if (code === "8480-6") systolic = value;
    if (code === "8462-4") diastolic = value;
  }
  return { systolic, diastolic };
}

function buildVitalsToday(rawVitals: Dict[], encounterDate: string): VisitContext["vitals_today"] {
  const sameDay = rawVitals.filter(
    (v) => dateOnly(v.effectiveDateTime as string) === encounterDate,
  );
  const out: VisitContext["vitals_today"] = {};

  // BP
  const bpObs = sameDay.find((o) => firstLoinc(asObj(o.code)) === "85354-9");
  if (bpObs) {
    const { systolic, diastolic } = bpFromObservation(bpObs);
    if (systolic !== null && diastolic !== null) out.bp = `${systolic}/${diastolic}`;
  }

  // HR
  const hrObs = sameDay.find((o) => firstLoinc(asObj(o.code)) === "8867-4");
  if (hrObs) {
    const v = asObj(hrObs.valueQuantity).value;
    if (typeof v === "number") out.hr = v;
  }

  // Today's weight + previous weight → delta
  const weights = rawVitals
    .filter((o) => firstLoinc(asObj(o.code)) === "29463-7")
    .map((o) => ({
      date: dateOnly(o.effectiveDateTime as string),
      kg: asObj(o.valueQuantity).value as number | undefined,
    }))
    .filter((w) => w.date && typeof w.kg === "number") as { date: string; kg: number }[];
  weights.sort((a, b) => b.date.localeCompare(a.date));
  const encounterWeight = weights.find((w) => w.date === encounterDate);
  const previous = weights.find((w) => w.date < encounterDate);
  if (encounterWeight) out.weight_kg = encounterWeight.kg;
  if (encounterWeight && previous) {
    out.weight_change_kg = Math.round((encounterWeight.kg - previous.kg) * 10) / 10;
  }
  return out;
}

function buildKeyLabs(rawLabs: Dict[]): VisitContext["key_labs_recent"] {
  const out: VisitContext["key_labs_recent"] = {};
  const egfr = mostRecentLabValueRaw(rawLabs, "33914-3");
  const k = mostRecentLabValueRaw(rawLabs, "2823-3");
  const a1c = mostRecentLabValueRaw(rawLabs, "4548-4");
  if (egfr !== null) out.egfr = egfr;
  if (k !== null) out.k = k;
  if (a1c !== null) out.a1c = a1c;
  return out;
}

function mostRecentLabValueRaw(rawLabs: Dict[], loinc: string): number | null {
  const matches = rawLabs.filter((l) => firstLoinc(asObj(l.code)) === loinc);
  matches.sort((a, b) => {
    const da = (a.effectiveDateTime as string | null) ?? "";
    const db = (b.effectiveDateTime as string | null) ?? "";
    return db.localeCompare(da);
  });
  const top = matches[0];
  if (!top) return null;
  const v = asObj(top.valueQuantity).value;
  return typeof v === "number" ? v : null;
}

function weeksBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / (MS_PER_DAY * 7));
}

function timingLabel(fromIso: string | null, targetIso: string | null): string | null {
  if (!fromIso || !targetIso) return null;
  const weeks = weeksBetween(fromIso, targetIso);
  if (weeks === null) return null;
  if (weeks <= 0) return "now";
  if (weeks === 1) return "1 week";
  if (weeks < 8) return `${weeks} weeks`;
  if (weeks < 52) {
    const months = Math.round(weeks / 4.345);
    return months === 1 ? "1 month" : `${months} months`;
  }
  return `${Math.round(weeks / 52)} year(s)`;
}

function categorizeServiceRequest(sr: Dict): "lab" | "imaging" | "other" {
  for (const cat of asArr(sr.category)) {
    const text = codingText(asObj(cat)).toLowerCase();
    if (text.includes("lab")) return "lab";
    if (text.includes("imaging") || text.includes("radiology")) return "imaging";
  }
  // Fall back to a code-text peek.
  const codeText = codingText(asObj(sr.code)).toLowerCase();
  if (codeText.includes("echo") || codeText.includes("xray") || codeText.includes("scan")) {
    return "imaging";
  }
  return "other";
}

function buildOrders(
  serviceRequests: Dict[],
  appointments: Dict[],
  encounterId: string,
  encounterStartIso: string | null,
): VisitContext["orders"] {
  const orders: VisitContext["orders"] = [];

  const matchEncounter = (resource: Dict): boolean => {
    const ref = (asObj(resource.encounter).reference as string | undefined) ?? "";
    return ref.endsWith(encounterId);
  };

  const today = encounterStartIso ?? new Date().toISOString();

  for (const sr of serviceRequests) {
    if (!matchEncounter(sr)) continue;
    const display = codingText(asObj(sr.code));
    const target = (sr.occurrenceDateTime as string | null) ?? null;
    orders.push({
      type: categorizeServiceRequest(sr),
      display: display || "Service request",
      timing: timingLabel(today, target),
    });
  }

  for (const appt of appointments) {
    const startIso = appt.start as string | null;
    if (!startIso) continue;
    // An appointment "belongs" to today's encounter if it was scheduled on/after the encounter date.
    if (encounterStartIso && startIso.slice(0, 10) <= encounterStartIso.slice(0, 10)) {
      // Past or same-day appointments aren't follow-up orders.
      continue;
    }
    const display =
      ((appt.description as string | undefined) ?? codingText(asObj(asArr(appt.serviceType)[0]))) ||
      "Appointment";
    orders.push({
      type: "appointment",
      display,
      timing: timingLabel(today, startIso),
    });
  }

  return orders;
}

interface MedExtras {
  reason?: string;
  behavior_rule?: string;
  dose_short?: string;
}

function extractMedExtras(rawMr: Dict): MedExtras {
  const out: MedExtras = {};
  const reasonText = (asObj(asArr(rawMr.reasonCode)[0]).text as string | undefined) ?? "";
  if (reasonText) out.reason = reasonText;

  const di = asObj(asArr(rawMr.dosageInstruction)[0]);
  const text = (di.text as string | undefined) ?? "";
  if (text && (di.asNeededBoolean === true || /\bPRN\b/i.test(text))) {
    // Split "Take 20 mg PO PRN — only on days you notice…" into dose + behavior.
    const sep = text.indexOf("—") >= 0 ? "—" : text.indexOf("--") >= 0 ? "--" : "";
    if (sep) {
      const parts = text.split(sep);
      const head = parts[0] ?? "";
      const tail = parts.slice(1).join(sep).trim();
      const dose = head.replace(/^\s*Take\s+/i, "").trim();
      if (dose) out.dose_short = dose;
      if (tail) out.behavior_rule = /^take\b/i.test(tail) ? tail : `Take ${tail}`;
    }
  }
  return out;
}

function decodeBase64Utf8(data: string): string {
  // atob is available in Workers; result is a binary string we decode as UTF-8.
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function clinicianSummaryFromDocBundle(docs: Dict[], encounterId: string): string | undefined {
  // Prefer DocumentReferences linked to today's encounter; fall back to the most recent.
  const linked = docs.filter((d) => {
    for (const ce of asArr(asObj(d.context).encounter)) {
      const ref = (asObj(ce).reference as string | undefined) ?? "";
      if (ref.endsWith(encounterId)) return true;
    }
    return false;
  });
  const candidates = linked.length > 0 ? linked : docs;
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => {
    const da = (a.date as string | null) ?? "";
    const db = (b.date as string | null) ?? "";
    return db.localeCompare(da);
  });
  for (const d of candidates) {
    for (const c of asArr(d.content)) {
      const att = asObj(asObj(c).attachment);
      const data = att.data;
      if (typeof data === "string" && data) {
        try {
          return decodeBase64Utf8(data);
        } catch {
          // try next
        }
      }
    }
  }
  return undefined;
}

function caregiverFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  // Patterns: "daughter Ana present", "Daughter Ana, reinforced…", "wife Maria present"
  const patterns = [
    /\b(daughter|son|wife|husband|partner|caregiver)\s+([A-Z][a-záéíóúñ]+)/,
    /\b(Daughter|Son|Wife|Husband|Partner|Caregiver)(\s+[A-Z][a-záéíóúñ]+)?\s+present/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const role = m?.[1];
    if (!role) continue;
    const named = m?.[2]?.trim();
    return named ? `${role.toLowerCase()} ${named}` : role.toLowerCase();
  }
  return undefined;
}

function emptyBundle(): FHIRBundle {
  return { resourceType: "Bundle", type: "searchset", total: 0, entry: [] };
}

async function optionalClinicalBundle(loader: () => Promise<FHIRBundle>): Promise<FHIRBundle> {
  try {
    return await loader();
  } catch (e) {
    if (e instanceof FHIRError && (e.statusCode === 401 || e.statusCode === 403)) {
      return emptyBundle();
    }
    throw e;
  }
}

async function packVisitContext(args: VisitContextInput): Promise<VisitContext | Dict> {
  const err = checkFhirContext({ requirePatient: true, patientId: args.patient_id });
  if (err) return err as unknown as Dict;
  const pid = resolvePatientId(args.patient_id) ?? "";

  let fhir: ReturnType<typeof fhirClientForCurrentContext>;
  try {
    fhir = fhirClientForCurrentContext();
  } catch (e) {
    if (e instanceof FHIRError) return e.toToolResponse() as Dict;
    throw e;
  }

  const [aggregateResult, serviceRequestBundle, appointmentBundle, documentBundle] =
    await Promise.all([
      aggregateVisitClinicalContext(pid, VISIT_CONTEXT_RECENT_ENCOUNTER_LOOKBACK_DAYS),
      optionalClinicalBundle(() => fhir.search("ServiceRequest", { patient: pid, _count: 50 })),
      optionalClinicalBundle(() => fhir.getAppointments(pid, { count: 25 })),
      optionalClinicalBundle(() => fhir.getDocumentReferences(pid, { count: 25 })),
    ]);

  if (aggregateResult && typeof aggregateResult === "object" && "error" in aggregateResult) {
    return aggregateResult as Dict;
  }
  let aggregate = aggregateResult as ClinicalContextAggregate;

  // Pick encounter via summary (id + start), then refetch raw for participant + canonical type.
  let encounterLookbackDays = VISIT_CONTEXT_RECENT_ENCOUNTER_LOOKBACK_DAYS;
  let encSummary = pickEncounter(aggregate.recent_encounters, args.encounter_id);
  if (!encSummary && !args.encounter_id) {
    const fallbackAggregateResult = await aggregateVisitClinicalContext(
      pid,
      VISIT_CONTEXT_FALLBACK_ENCOUNTER_LOOKBACK_DAYS,
    );
    if (
      fallbackAggregateResult &&
      typeof fallbackAggregateResult === "object" &&
      "error" in fallbackAggregateResult
    ) {
      return fallbackAggregateResult as Dict;
    }
    const fallbackAggregate = fallbackAggregateResult as ClinicalContextAggregate;
    const fallbackEncounter = pickEncounter(fallbackAggregate.recent_encounters, undefined);
    if (fallbackEncounter) {
      aggregate = fallbackAggregate;
      encSummary = fallbackEncounter;
      encounterLookbackDays = VISIT_CONTEXT_FALLBACK_ENCOUNTER_LOOKBACK_DAYS;
    }
  }
  if (!encSummary) {
    const message = args.encounter_id
      ? "No encounter found for this patient with the requested `encounter_id`. Check the encounter ID or load encounter data."
      : `No encounter found for this patient after searching the last ${encounterLookbackLabel(
          encounterLookbackDays,
        )}. Pass \`encounter_id\` explicitly or load encounter data.`;
    return {
      error: "no_encounter_found",
      message,
      patient_id: pid,
    };
  }
  const rawResources = aggregate.raw_resources;
  const encounterId = encSummary.id as string;
  let rawEncounter: Dict = {};
  try {
    rawEncounter = await fhir.getResource("Encounter", encounterId);
  } catch (e) {
    if (!(e instanceof FHIRError)) throw e;
    // Continue with summary-only data.
  }

  const encounterStartIso = (encSummary.start as string | null) ?? null;
  const encounterDate = dateOnly(encounterStartIso) ?? "";

  // Patient block
  const language = args.language ?? preferredLanguageFromPatient(asObj(rawResources?.patient));
  const patientBlock: VisitContext["patient"] = {
    id: pid,
    name: (aggregate.demographics.name as string) ?? pid,
    age: (aggregate.demographics.age as number | null) ?? null,
    preferred_language: language,
    reading_level_target: readingLevelTargetFor(language),
  };

  // Encounter block
  const encounterBlock: VisitContext["encounter"] = {
    id: encounterId,
    date: encounterDate,
    type: encounterTypeSlug(rawEncounter, encSummary.type as string | null),
    provider:
      providerFromEncounter(rawEncounter) ?? (encSummary.service_provider as string | null) ?? null,
    reason: (encSummary.reason as string | null) ?? null,
  };

  // Active problems — enrich each from labs + condition text
  const conditionTextById = new Map<string, string>();
  for (const c of rawResources?.conditions ?? []) {
    conditionTextById.set(
      (c.id as string) ?? "",
      (asObj(c.code).text as string) ?? codingText(asObj(c.code)),
    );
  }
  const activeProblems: VisitContext["active_problems"] = aggregate.active_problems.map((p) => {
    const display = (p.name as string) ?? "";
    const rawText = conditionTextById.get((p.id as string) ?? "") ?? display;
    const enrichment = enrichProblem(display, rawText, aggregate.recent_labs);
    return {
      display,
      icd10: (p.icd_code as string | null) ?? null,
      snomed: (p.snomed as string | null) ?? null,
      ...enrichment,
    };
  });

  // Medication changes — derive action from authoredOn vs encounter start
  const medExtrasById = new Map<string, MedExtras>();
  for (const mr of rawResources?.medication_requests ?? []) {
    medExtrasById.set((mr.id as string) ?? "", extractMedExtras(mr));
  }
  const cutoff = encounterDate;
  const medicationChanges: VisitContext["medication_changes"] = aggregate.active_medications.map(
    (m) => {
      const authored = dateOnly(m.authored_on as string) ?? "";
      const action: "new" | "continue" =
        cutoff && authored && authored >= cutoff ? "new" : "continue";
      const extras = medExtrasById.get((m.id as string) ?? "") ?? {};
      const dose = extras.dose_short ?? ((m.dose as string) || "");
      const change: VisitContext["medication_changes"][number] = {
        action,
        name: (m.name as string) ?? "",
        dose,
        authored_on: (m.authored_on as string | null) ?? null,
      };
      if (extras.reason) change.reason = extras.reason;
      if (action === "new" && extras.behavior_rule) {
        change.behavior_rule = extras.behavior_rule;
      }
      return change;
    },
  );
  // New first, then continue; within each, by authored_on desc.
  medicationChanges.sort((a, b) => {
    if (a.action !== b.action) return a.action === "new" ? -1 : 1;
    const da = a.authored_on ?? "";
    const db = b.authored_on ?? "";
    return db.localeCompare(da);
  });

  // Orders
  const serviceRequests = bundleToResources(asObj(serviceRequestBundle));
  const appointments = bundleToResources(asObj(appointmentBundle));
  const orders = buildOrders(serviceRequests, appointments, encounterId, encounterStartIso);

  // Vitals + labs (raw, since we want components)
  const rawVitals = rawResources?.vitals ?? [];
  const rawLabs = rawResources?.labs ?? [];
  const vitalsToday = buildVitalsToday(rawVitals, encounterDate);
  const keyLabs = buildKeyLabs(rawLabs);

  // Note text + caregiver
  const documents = bundleToResources(asObj(documentBundle));
  const clinicianSummary = clinicianSummaryFromDocBundle(documents, encounterId);
  const caregiver = caregiverFromText(clinicianSummary);

  const out: VisitContext = {
    patient: patientBlock,
    encounter: encounterBlock,
    active_problems: activeProblems,
    medication_changes: medicationChanges,
    orders,
    vitals_today: vitalsToday,
    key_labs_recent: keyLabs,
  };
  if (caregiver) out.caregiver_present = caregiver;
  if (clinicianSummary) out.clinician_summary = clinicianSummary;
  return out;
}

export function registerClinicalVisitContextTools(server: McpServer): void {
  server.tool(
    "clinical_pack_visit_context",
    "Pack a typed visit-context payload for a finalized clinical encounter. " +
      "Composes encounter, active problems, medication changes (with `new` vs `continue` derived from " +
      "`MedicationRequest.authoredOn` against the encounter start date), follow-up orders, today's vitals, " +
      "recent key labs, and the clinician note text from `DocumentReference`. Snake_case JSON. " +
      "Designed for downstream patient-education / coding / closure workflows.",
    visitContextInputSchema,
    async (args) => packVisitContext(args),
  );
}

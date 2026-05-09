/**
 * Pure helpers for normalizing FHIR R4 resources into compact, LLM-friendly
 * dicts. Every helper is null-safe and never throws on partial / malformed
 * resources — clinical data in the wild rarely conforms perfectly to spec.
 *
 * Returned objects use snake_case keys to preserve wire compatibility with
 * the Python `sharp-fhir-mcp` server.
 */
import type { FHIRBundle } from "./clients/fhir-client.ts";

type Dict = Record<string, unknown>;

const asObj = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

// --
// Bundle helpers
// --

export function* iterBundleResources(bundle: FHIRBundle | Dict | null | undefined): Iterable<Dict> {
  for (const entry of asArr((bundle as Dict | null | undefined)?.entry)) {
    const resource = (entry as Dict)?.resource;
    if (resource && typeof resource === "object") yield resource as Dict;
  }
}

export function bundleToResources(bundle: FHIRBundle | Dict | null | undefined): Dict[] {
  return [...iterBundleResources(bundle)];
}

export function bundleTotal(bundle: FHIRBundle | Dict | null | undefined): number {
  if (!bundle || typeof bundle !== "object") return 0;
  const total = (bundle as Dict).total;
  if (typeof total === "number") return total;
  return asArr((bundle as Dict).entry).length;
}

export function bundleNextLink(bundle: FHIRBundle | Dict | null | undefined): string | null {
  for (const link of asArr((bundle as Dict | null | undefined)?.link)) {
    const l = link as Dict;
    if (l.relation === "next" && typeof l.url === "string") return l.url;
  }
  return null;
}

// --
// CodeableConcept / Coding
// --

export function codingText(concept: Dict | null | undefined): string {
  if (!concept) return "";
  if (typeof concept.text === "string" && concept.text) return concept.text;
  for (const c of asArr(concept.coding)) {
    const co = c as Dict;
    if (typeof co.display === "string" && co.display) return co.display;
    if (typeof co.code === "string" && co.code) return co.code;
  }
  return "";
}

export function firstCoding(concept: Dict | null | undefined): Dict {
  const codings = asArr(concept?.coding);
  return (codings[0] as Dict) ?? {};
}

export function categoryCodes(resource: Dict): string[] {
  const out: string[] = [];
  for (const cat of asArr(resource.category)) {
    for (const c of asArr((cat as Dict).coding)) {
      const code = (c as Dict).code;
      if (typeof code === "string" && code) out.push(code);
    }
  }
  return out;
}

// --
// Patient
// --

export function humanizeName(name: Dict | null | undefined): string {
  if (!name) return "";
  if (typeof name.text === "string" && name.text) return name.text;
  const given = asArr(name.given).filter((g) => typeof g === "string").join(" ");
  const family = typeof name.family === "string" ? name.family : "";
  return [given, family].filter(Boolean).join(" ");
}

export function patientDisplayName(patient: Dict): string {
  const names = asArr(patient.name) as Dict[];
  if (names.length === 0) return `Patient/${patient.id ?? ""}`.replace(/\/$/, "");
  const byUse = new Map(names.map((n) => [String(n.use ?? ""), n]));
  const chosen = byUse.get("official") ?? byUse.get("usual") ?? names[0];
  return humanizeName(chosen) || `Patient/${patient.id ?? ""}`;
}

function telecom(patient: Dict, system: string): string | null {
  for (const t of asArr(patient.telecom)) {
    const tt = t as Dict;
    if (tt.system === system && typeof tt.value === "string" && tt.value) return tt.value;
  }
  return null;
}

export const patientPhone = (p: Dict): string | null => telecom(p, "phone");
export const patientEmail = (p: Dict): string | null => telecom(p, "email");

export function patientAddress(patient: Dict): string | null {
  const addresses = asArr(patient.address);
  if (addresses.length === 0) return null;
  const a = addresses[0] as Dict;
  if (typeof a.text === "string" && a.text) return a.text;
  const parts: string[] = [];
  const line = asArr(a.line).filter((x) => typeof x === "string");
  if (line.length) parts.push((line as string[]).join(", "));
  const cityState = [a.city, a.state].filter((x) => typeof x === "string" && x).join(" ");
  if (cityState) parts.push(cityState);
  if (a.postalCode) parts.push(String(a.postalCode));
  return parts.length ? parts.join(", ") : null;
}

export function calculateAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const parts = birthDate.split("-");
  const year = Number.parseInt(parts[0] ?? "", 10);
  if (!Number.isFinite(year)) return null;
  const month = Number.parseInt(parts[1] ?? "1", 10) || 1;
  const day = Number.parseInt((parts[2] ?? "1").slice(0, 2), 10) || 1;
  const bd = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(bd.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - bd.getUTCFullYear();
  const m = today.getUTCMonth() - bd.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < bd.getUTCDate())) age -= 1;
  return age;
}

export function patientSummary(patient: Dict): Dict {
  return {
    id: patient.id ?? null,
    name: patientDisplayName(patient),
    gender: patient.gender ?? null,
    date_of_birth: patient.birthDate ?? null,
    age: calculateAge(asStr(patient.birthDate)),
    phone: patientPhone(patient),
    email: patientEmail(patient),
    address: patientAddress(patient),
    active: patient.active ?? null,
  };
}

// --
// Observation
// --

export function observationValue(obs: Dict): { value: unknown; unit: string | null } {
  const qty = asObj(obs.valueQuantity);
  if (Object.keys(qty).length) {
    return { value: qty.value ?? null, unit: (qty.unit as string) ?? (qty.code as string) ?? null };
  }
  if ("valueString" in obs) return { value: obs.valueString, unit: null };
  if ("valueBoolean" in obs) return { value: obs.valueBoolean, unit: null };
  if ("valueInteger" in obs) return { value: obs.valueInteger, unit: null };
  const cc = asObj(obs.valueCodeableConcept);
  if (Object.keys(cc).length) return { value: codingText(cc), unit: null };
  const rng = asObj(obs.valueRange);
  if (Object.keys(rng).length) {
    const low = (asObj(rng.low).value as number | undefined) ?? null;
    const high = (asObj(rng.high).value as number | undefined) ?? null;
    return { value: `${low}–${high}`, unit: (asObj(rng.low).unit as string) ?? null };
  }
  return { value: null, unit: null };
}

export function observationReferenceRange(obs: Dict): string | null {
  const ranges = asArr(obs.referenceRange);
  if (ranges.length === 0) return null;
  const r = ranges[0] as Dict;
  if (typeof r.text === "string" && r.text) return r.text;
  const low = asObj(r.low).value as number | undefined;
  const high = asObj(r.high).value as number | undefined;
  const unit =
    (asObj(r.low).unit as string | undefined) ?? (asObj(r.high).unit as string | undefined) ?? "";
  if (low !== undefined && high !== undefined) return `${low}–${high} ${unit}`.trim();
  if (low !== undefined) return `>${low} ${unit}`.trim();
  if (high !== undefined) return `<${high} ${unit}`.trim();
  return null;
}

export function observationIsAbnormal(obs: Dict): boolean {
  const abnormal = new Set(["H", "L", "HH", "LL", "A", "AA", "HU", "LU"]);
  for (const interp of asArr(obs.interpretation)) {
    for (const c of asArr((interp as Dict).coding)) {
      if (abnormal.has(String((c as Dict).code))) return true;
    }
  }
  return false;
}

function firstSystemCode(concept: Dict, predicate: (system: string) => boolean): string | null {
  for (const c of asArr(concept.coding)) {
    const co = c as Dict;
    const sys = (co.system as string) ?? "";
    if (predicate(sys.toLowerCase()) && co.code) return String(co.code);
  }
  return null;
}

const firstLoinc = (c: Dict): string | null =>
  firstSystemCode(c, (s) => s === "http://loinc.org");
const firstIcd = (c: Dict): string | null =>
  firstSystemCode(c, (s) => s.includes("icd-10") || s.includes("icd-9"));
const firstSnomed = (c: Dict): string | null =>
  firstSystemCode(c, (s) => s === "http://snomed.info/sct");
const firstRxnorm = (c: Dict): string | null =>
  firstSystemCode(c, (s) => s === "http://www.nlm.nih.gov/research/umls/rxnorm");
const firstCvx = (c: Dict): string | null =>
  firstSystemCode(c, (s) => s.endsWith("cvx") || s.includes("cvx"));

export function observationSummary(obs: Dict): Dict {
  const { value, unit } = observationValue(obs);
  return {
    id: obs.id ?? null,
    test: codingText(asObj(obs.code)),
    loinc: firstLoinc(asObj(obs.code)),
    value,
    unit,
    normal_range: observationReferenceRange(obs),
    abnormal: observationIsAbnormal(obs),
    categories: categoryCodes(obs),
    date:
      obs.effectiveDateTime ??
      asObj(obs.effectivePeriod).start ??
      obs.issued ??
      null,
    status: obs.status ?? null,
  };
}

// --
// Condition / Allergy / Medication / Immunization / etc
// --

export function conditionSummary(c: Dict): Dict {
  return {
    id: c.id ?? null,
    name: codingText(asObj(c.code)),
    icd_code: firstIcd(asObj(c.code)),
    snomed: firstSnomed(asObj(c.code)),
    clinical_status: codingText(asObj(c.clinicalStatus)),
    verification_status: codingText(asObj(c.verificationStatus)),
    onset_date: c.onsetDateTime ?? asObj(c.onsetPeriod).start ?? null,
    recorded_date: c.recordedDate ?? null,
    category: asArr(c.category).length ? codingText(asArr(c.category)[0] as Dict) : null,
    severity: codingText(asObj(c.severity)),
  };
}

export function allergySummary(a: Dict): Dict {
  const reactions: string[] = [];
  let severity: string | null = null;
  for (const r of asArr(a.reaction)) {
    const rr = r as Dict;
    for (const m of asArr(rr.manifestation)) {
      const t = codingText(m as Dict);
      if (t) reactions.push(t);
    }
    if (!severity && typeof rr.severity === "string") severity = rr.severity;
  }
  return {
    id: a.id ?? null,
    allergen: codingText(asObj(a.code)),
    type: a.type ?? null,
    category: asArr(a.category)[0] ?? null,
    criticality: a.criticality ?? null,
    clinical_status: codingText(asObj(a.clinicalStatus)),
    verification_status: codingText(asObj(a.verificationStatus)),
    reaction: reactions.length ? reactions.join(", ") : null,
    severity,
    onset_date: a.onsetDateTime ?? null,
    recorded_date: a.recordedDate ?? null,
  };
}

export function medicationRequestSummary(m: Dict): Dict {
  let med = asObj(m.medicationCodeableConcept);
  if (Object.keys(med).length === 0 && m.medicationReference) {
    med = { text: asObj(m.medicationReference).display ?? "" };
  }
  const di = (asArr(m.dosageInstruction)[0] as Dict | undefined) ?? {};
  let dose = "";
  if (typeof di.text === "string" && di.text) {
    dose = di.text;
  } else {
    const dq = asObj((asArr(di.doseAndRate)[0] as Dict | undefined)?.doseQuantity);
    dose = `${dq.value ?? ""} ${dq.unit ?? ""}`.trim();
  }
  const timingCode = asObj(asObj(di.timing).code);
  const timing = (timingCode.text as string) ?? codingText(timingCode);
  return {
    id: m.id ?? null,
    name: codingText(med),
    rxnorm: firstRxnorm(med),
    dose,
    frequency: timing,
    route: codingText(asObj(di.route)),
    status: m.status ?? null,
    intent: m.intent ?? null,
    authored_on: m.authoredOn ?? null,
    requester: asObj(m.requester).display ?? null,
  };
}

export function immunizationSummary(i: Dict): Dict {
  return {
    id: i.id ?? null,
    vaccine: codingText(asObj(i.vaccineCode)),
    cvx_code: firstCvx(asObj(i.vaccineCode)),
    status: i.status ?? null,
    date_administered: i.occurrenceDateTime ?? null,
    lot_number: i.lotNumber ?? null,
  };
}

export function diagnosticReportSummary(r: Dict): Dict {
  return {
    id: r.id ?? null,
    name: codingText(asObj(r.code)),
    category: asArr(r.category).length ? codingText(asArr(r.category)[0] as Dict) : null,
    status: r.status ?? null,
    date: r.effectiveDateTime ?? asObj(r.effectivePeriod).start ?? r.issued ?? null,
    conclusion: r.conclusion ?? null,
    result_count: asArr(r.result).length,
  };
}

export function encounterSummary(e: Dict): Dict {
  const klass = asObj(e.class);
  return {
    id: e.id ?? null,
    status: e.status ?? null,
    class: (klass.display as string) ?? (klass.code as string) ?? null,
    type: asArr(e.type).length ? codingText(asArr(e.type)[0] as Dict) : null,
    reason: asArr(e.reasonCode).length ? codingText(asArr(e.reasonCode)[0] as Dict) : null,
    start: asObj(e.period).start ?? null,
    end: asObj(e.period).end ?? null,
    service_provider: asObj(e.serviceProvider).display ?? null,
  };
}

export function appointmentSummary(a: Dict): Dict {
  return {
    id: a.id ?? null,
    status: a.status ?? null,
    service_type: asArr(a.serviceType).length
      ? codingText(asArr(a.serviceType)[0] as Dict)
      : null,
    appointment_type: codingText(asObj(a.appointmentType)),
    reason: asArr(a.reasonCode).length ? codingText(asArr(a.reasonCode)[0] as Dict) : null,
    description: a.description ?? null,
    start: a.start ?? null,
    end: a.end ?? null,
    minutes_duration: a.minutesDuration ?? null,
    comment: a.comment ?? null,
  };
}

export function documentReferenceSummary(d: Dict): Dict {
  const attachments: Dict[] = [];
  for (const content of asArr(d.content)) {
    const att = asObj((content as Dict).attachment);
    if (att.url || att.data) {
      attachments.push({
        url: att.url ?? null,
        content_type: att.contentType ?? null,
        title: att.title ?? null,
        size: att.size ?? null,
      });
    }
  }
  return {
    id: d.id ?? null,
    type: codingText(asObj(d.type)),
    category: asArr(d.category).length ? codingText(asArr(d.category)[0] as Dict) : null,
    status: d.status ?? null,
    doc_status: d.docStatus ?? null,
    date: d.date ?? null,
    description: d.description ?? null,
    attachments,
  };
}

export function coverageSummary(c: Dict): Dict {
  return {
    id: c.id ?? null,
    status: c.status ?? null,
    type: codingText(asObj(c.type)),
    subscriber_id: c.subscriberId ?? null,
    payor: asArr(c.payor).length ? asObj(asArr(c.payor)[0] as Dict).display ?? null : null,
    period_start: asObj(c.period).start ?? null,
    period_end: asObj(c.period).end ?? null,
  };
}

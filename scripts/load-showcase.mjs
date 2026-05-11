#!/usr/bin/env node
/**
 * Load a rich synthetic showcase patient for the Featherless MCP-UI demo.
 *
 * Default target is public HAPI R4 because the deployed Cloudflare MCP Worker
 * must be able to reach the FHIR server during the Agent Zero iframe demo.
 *
 * Usage:
 *   npm run load:showcase
 *   FHIR_SERVER_URL=http://localhost:8080/fhir SKIP_LIVE_MCP=1 npm run load:showcase
 */

import process from "node:process";

const FHIR_SERVER_URL = (process.env.FHIR_SERVER_URL ?? "https://hapi.fhir.org/baseR4").replace(
  /\/+$/,
  "",
);
const LIVE_MCP_URL =
  process.env.FEATHERLESS_MCP_URL ??
  "https://featherless-mcp.inf3ctious007.workers.dev/mcp";
const PATIENT_ID = "featherless-showcase-carter-elena";
const PATIENT_DISPLAY = "Elena Carter";
const TIMEOUT_MS = 45_000;

const SYSTEMS = {
  snomed: "http://snomed.info/sct",
  loinc: "http://loinc.org",
  rxnorm: "http://www.nlm.nih.gov/research/umls/rxnorm",
  icd10: "http://hl7.org/fhir/sid/icd-10-cm",
  cvx: "http://hl7.org/fhir/sid/cvx",
  obsCategory: "http://terminology.hl7.org/CodeSystem/observation-category",
  conditionCategory: "http://terminology.hl7.org/CodeSystem/condition-category",
  conditionClinical: "http://terminology.hl7.org/CodeSystem/condition-clinical",
  conditionVerification: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
  allergyClinical: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
  allergyVerification: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
  interpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  encounterClass: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
};

function color(code, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (t) => color("32", t);
const red = (t) => color("31", t);
const yellow = (t) => color("33", t);
const dim = (t) => color("2", t);

function coding(system, code, display) {
  return { system, code, display };
}

function concept(text, codings = []) {
  return { coding: codings, text };
}

function reference(resourceType, id, display) {
  return { reference: `${resourceType}/${id}`, display };
}

function patientRef() {
  return reference("Patient", PATIENT_ID, PATIENT_DISPLAY);
}

function activeClinicalStatus(system = SYSTEMS.conditionClinical) {
  return concept("Active", [coding(system, "active", "Active")]);
}

function confirmedVerificationStatus(system = SYSTEMS.conditionVerification) {
  return concept("Confirmed", [coding(system, "confirmed", "Confirmed")]);
}

function medicationId(name) {
  return `med-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function conditionId(name) {
  return `condition-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function allergyId(name) {
  return `allergy-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function patient() {
  return {
    resourceType: "Patient",
    id: PATIENT_ID,
    meta: {
      profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"],
      tag: [coding("https://featherless.dev/fhir/tags", "showcase-demo", "Featherless Showcase")],
    },
    active: true,
    name: [{ use: "official", family: "Carter", given: ["Elena"] }],
    gender: "female",
    birthDate: "1968-03-14",
    telecom: [
      { system: "phone", value: "555-0104", use: "mobile" },
      { system: "email", value: "elena.carter.synthetic@example.org", use: "home" },
    ],
    address: [
      {
        use: "home",
        line: ["42 Demo Harbor Lane"],
        city: "San Mateo",
        state: "CA",
        postalCode: "94401",
        country: "US",
      },
    ],
  };
}

function practitioner() {
  return {
    resourceType: "Practitioner",
    id: "featherless-demo-clinician",
    active: true,
    name: [{ use: "official", family: "Rivera", given: ["Maya"] }],
  };
}

function organization() {
  return {
    resourceType: "Organization",
    id: "featherless-demo-clinic",
    active: true,
    name: "Featherless Demo Clinic",
  };
}

function allergy({ name, code, category, criticality, reaction, severity, onset }) {
  return {
    resourceType: "AllergyIntolerance",
    id: allergyId(name),
    clinicalStatus: activeClinicalStatus(SYSTEMS.allergyClinical),
    verificationStatus: confirmedVerificationStatus(SYSTEMS.allergyVerification),
    type: "allergy",
    category: [category],
    criticality,
    patient: patientRef(),
    code: concept(name, [coding(SYSTEMS.snomed, code, name)]),
    onsetDateTime: onset,
    recordedDate: "2025-02-10",
    reaction: [
      {
        manifestation: [concept(reaction)],
        severity,
      },
    ],
  };
}

function condition({ name, icd, snomed, onset, category, severity }) {
  return {
    resourceType: "Condition",
    id: conditionId(name),
    clinicalStatus: activeClinicalStatus(),
    verificationStatus: confirmedVerificationStatus(),
    category: [
      concept("Problem List Item", [
        coding(SYSTEMS.conditionCategory, "problem-list-item", "Problem List Item"),
      ]),
    ],
    severity: severity ? concept(severity) : undefined,
    code: concept(name, [
      coding(SYSTEMS.icd10, icd, name),
      ...(snomed ? [coding(SYSTEMS.snomed, snomed, name)] : []),
    ]),
    subject: patientRef(),
    onsetDateTime: onset,
    recordedDate: "2025-02-10",
    note: [{ text: category }],
  };
}

function medication({ name, rxnorm, dose, frequency, authoredOn }) {
  return {
    resourceType: "MedicationRequest",
    id: medicationId(name),
    status: "active",
    intent: "order",
    medicationCodeableConcept: concept(name, [coding(SYSTEMS.rxnorm, rxnorm, name)]),
    subject: patientRef(),
    authoredOn,
    requester: reference("Practitioner", "featherless-demo-clinician", "Featherless Demo Clinician"),
    dosageInstruction: [
      {
        text: dose,
        timing: { code: concept(frequency) },
        route: concept("Oral route", [coding(SYSTEMS.snomed, "26643006", "Oral route")]),
      },
    ],
  };
}

function immunization({ id, vaccine, cvx, date }) {
  return {
    resourceType: "Immunization",
    id,
    status: "completed",
    vaccineCode: concept(vaccine, [coding(SYSTEMS.cvx, cvx, vaccine)]),
    patient: patientRef(),
    occurrenceDateTime: date,
    lotNumber: `SYN-${id.toUpperCase()}`,
  };
}

function encounter({ id, date, reason, klass = "AMB", status = "finished" }) {
  return {
    resourceType: "Encounter",
    id,
    status,
    class: coding(SYSTEMS.encounterClass, klass, klass),
    type: [concept("Outpatient visit")],
    subject: patientRef(),
    period: {
      start: `${date}T09:00:00-08:00`,
      end: `${date}T09:45:00-08:00`,
    },
    reasonCode: [concept(reason)],
    serviceProvider: reference("Organization", "featherless-demo-clinic", "Featherless Demo Clinic"),
  };
}

function interpretationCode(value, low, high) {
  if (typeof low === "number" && value < low) return ["L", "Low"];
  if (typeof high === "number" && value > high) return ["H", "High"];
  return null;
}

function labObservation({ key, display, loinc, date, value, unit, low, high }) {
  const abnormal = interpretationCode(value, low, high);
  return {
    resourceType: "Observation",
    id: `lab-${key}-${date}`,
    status: "final",
    category: [
      concept("Laboratory", [coding(SYSTEMS.obsCategory, "laboratory", "Laboratory")]),
    ],
    code: concept(display, [coding(SYSTEMS.loinc, loinc, display)]),
    subject: patientRef(),
    effectiveDateTime: `${date}T08:30:00-08:00`,
    valueQuantity: {
      value,
      unit,
      system: "http://unitsofmeasure.org",
      code: unit,
    },
    referenceRange:
      typeof low === "number" || typeof high === "number"
        ? [
            {
              low: typeof low === "number" ? { value: low, unit } : undefined,
              high: typeof high === "number" ? { value: high, unit } : undefined,
            },
          ]
        : undefined,
    interpretation: abnormal
      ? [
          concept(abnormal[1], [
            coding(SYSTEMS.interpretation, abnormal[0], abnormal[1]),
          ]),
        ]
      : undefined,
  };
}

function labSeries({ key, display, loinc, unit, low, high, points }) {
  return points.map(([date, value]) =>
    labObservation({ key, display, loinc, date, value, unit, low, high }),
  );
}

function buildResources() {
  const resources = [
    patient(),
    practitioner(),
    organization(),
    allergy({
      name: "Penicillin G",
      code: "91936005",
      category: "medication",
      criticality: "high",
      reaction: "Urticaria and throat tightness",
      severity: "severe",
      onset: "1998-05-12",
    }),
    allergy({
      name: "Sulfonamide antibacterial",
      code: "91939003",
      category: "medication",
      criticality: "high",
      reaction: "Diffuse maculopapular rash",
      severity: "moderate",
      onset: "2009-09-03",
    }),
    allergy({
      name: "Latex",
      code: "300916003",
      category: "environment",
      criticality: "low",
      reaction: "Contact dermatitis",
      severity: "mild",
      onset: "2018-01-15",
    }),
    condition({
      name: "Type 2 diabetes mellitus",
      icd: "E11.9",
      snomed: "44054006",
      onset: "2012-06-01",
      category: "Endocrine",
      severity: "moderate",
    }),
    condition({
      name: "Chronic systolic heart failure",
      icd: "I50.22",
      snomed: "441481004",
      onset: "2020-11-20",
      category: "Cardiovascular",
      severity: "moderate",
    }),
    condition({
      name: "Chronic kidney disease stage 3b",
      icd: "N18.32",
      snomed: "700379002",
      onset: "2021-04-18",
      category: "Renal",
      severity: "moderate",
    }),
    condition({
      name: "Essential hypertension",
      icd: "I10",
      snomed: "59621000",
      onset: "2010-03-10",
      category: "Cardiovascular",
      severity: "moderate",
    }),
    condition({
      name: "Hyperlipidemia",
      icd: "E78.5",
      snomed: "55822004",
      onset: "2014-10-08",
      category: "Cardiovascular",
      severity: "mild",
    }),
    condition({
      name: "COPD with intermittent asthma symptoms",
      icd: "J44.9",
      snomed: "13645005",
      onset: "2019-02-01",
      category: "Respiratory",
      severity: "moderate",
    }),
    condition({
      name: "Major depressive disorder",
      icd: "F33.1",
      snomed: "66344007",
      onset: "2017-07-22",
      category: "Mental Health",
      severity: "moderate",
    }),
    condition({
      name: "Obesity",
      icd: "E66.9",
      snomed: "414916001",
      onset: "2015-04-12",
      category: "Endocrine",
      severity: "moderate",
    }),
    condition({
      name: "Chronic low back pain",
      icd: "M54.50",
      snomed: "279039007",
      onset: "2016-09-16",
      category: "Musculoskeletal",
      severity: "mild",
    }),
    medication({
      name: "Metformin 1000 MG Oral Tablet",
      rxnorm: "861004",
      dose: "Take 1 tablet by mouth twice daily with meals",
      frequency: "Twice daily",
      authoredOn: "2024-01-10",
    }),
    medication({
      name: "Insulin glargine 100 UNT/ML Injectable Solution",
      rxnorm: "311041",
      dose: "Inject 26 units subcutaneously every evening",
      frequency: "Every evening",
      authoredOn: "2024-03-15",
    }),
    medication({
      name: "Empagliflozin 10 MG Oral Tablet",
      rxnorm: "1545653",
      dose: "Take 1 tablet by mouth each morning",
      frequency: "Daily",
      authoredOn: "2025-01-18",
    }),
    medication({
      name: "Lisinopril 20 MG Oral Tablet",
      rxnorm: "314077",
      dose: "Take 1 tablet by mouth daily",
      frequency: "Daily",
      authoredOn: "2022-06-12",
    }),
    medication({
      name: "Carvedilol 12.5 MG Oral Tablet",
      rxnorm: "200031",
      dose: "Take 1 tablet by mouth twice daily",
      frequency: "Twice daily",
      authoredOn: "2021-02-02",
    }),
    medication({
      name: "Furosemide 40 MG Oral Tablet",
      rxnorm: "310429",
      dose: "Take 1 tablet by mouth each morning; take extra dose for rapid weight gain",
      frequency: "Daily",
      authoredOn: "2024-11-05",
    }),
    medication({
      name: "Atorvastatin 40 MG Oral Tablet",
      rxnorm: "617320",
      dose: "Take 1 tablet by mouth nightly",
      frequency: "Nightly",
      authoredOn: "2020-08-19",
    }),
    medication({
      name: "Aspirin 81 MG Delayed Release Oral Tablet",
      rxnorm: "243670",
      dose: "Take 1 tablet by mouth daily",
      frequency: "Daily",
      authoredOn: "2020-08-19",
    }),
    medication({
      name: "Tiotropium 18 MCG Inhalation Capsule",
      rxnorm: "485032",
      dose: "Inhale contents of 1 capsule once daily",
      frequency: "Daily",
      authoredOn: "2024-04-02",
    }),
    medication({
      name: "Albuterol 0.09 MG/ACTUAT Metered Dose Inhaler",
      rxnorm: "745679",
      dose: "Inhale 2 puffs every 4 hours as needed for wheeze",
      frequency: "As needed",
      authoredOn: "2025-09-01",
    }),
    medication({
      name: "Sertraline 50 MG Oral Tablet",
      rxnorm: "312941",
      dose: "Take 1 tablet by mouth daily",
      frequency: "Daily",
      authoredOn: "2023-05-14",
    }),
    medication({
      name: "Omeprazole 20 MG Delayed Release Oral Capsule",
      rxnorm: "198051",
      dose: "Take 1 capsule by mouth daily before breakfast",
      frequency: "Daily",
      authoredOn: "2024-07-20",
    }),
    immunization({ id: "imm-flu-2025", vaccine: "Influenza seasonal injectable", cvx: "141", date: "2025-10-03" }),
    immunization({ id: "imm-covid-2025", vaccine: "COVID-19 mRNA seasonal vaccine", cvx: "213", date: "2025-10-03" }),
    immunization({ id: "imm-pcv20", vaccine: "Pneumococcal conjugate PCV20", cvx: "216", date: "2024-11-19" }),
    immunization({ id: "imm-tdap", vaccine: "Tdap", cvx: "115", date: "2024-06-11" }),
    immunization({ id: "imm-zoster", vaccine: "Zoster recombinant", cvx: "187", date: "2025-01-22" }),
    encounter({ id: "enc-2025-02-10", date: "2025-02-10", reason: "Diabetes follow-up and medication reconciliation" }),
    encounter({ id: "enc-2025-03-24", date: "2025-03-24", reason: "Dyspnea and heart failure weight gain" }),
    encounter({ id: "enc-2025-05-01", date: "2025-05-01", reason: "Chronic kidney disease lab review" }),
    encounter({ id: "enc-2025-06-18", date: "2025-06-18", reason: "COPD exacerbation follow-up" }),
    encounter({ id: "enc-2025-08-01", date: "2025-08-01", reason: "A1c and blood pressure review" }),
    encounter({ id: "enc-2025-09-15", date: "2025-09-15", reason: "Depression screening and care plan update" }),
    encounter({ id: "enc-2025-11-10", date: "2025-11-10", reason: "Cardiology medication titration" }),
    encounter({ id: "enc-2026-01-12", date: "2026-01-12", reason: "Annual wellness and immunization review" }),
    encounter({ id: "enc-2026-03-02", date: "2026-03-02", reason: "Emergency department follow-up", klass: "EMER" }),
    encounter({ id: "enc-2026-04-20", date: "2026-04-20", reason: "Integrated chronic disease review" }),
    ...labSeries({
      key: "a1c",
      display: "Hemoglobin A1c",
      loinc: "4548-4",
      unit: "%",
      low: 4,
      high: 5.6,
      points: [
        ["2025-02-10", 8.9],
        ["2025-05-01", 8.4],
        ["2025-08-01", 7.8],
        ["2025-11-10", 7.3],
        ["2026-04-20", 6.9],
      ],
    }),
    ...labSeries({
      key: "egfr",
      display: "Estimated glomerular filtration rate",
      loinc: "33914-3",
      unit: "mL/min/1.73m2",
      low: 60,
      points: [
        ["2025-02-10", 42],
        ["2025-05-01", 39],
        ["2025-08-01", 36],
        ["2025-11-10", 38],
        ["2026-04-20", 41],
      ],
    }),
    ...labSeries({
      key: "potassium",
      display: "Potassium",
      loinc: "2823-3",
      unit: "mmol/L",
      low: 3.5,
      high: 5.1,
      points: [
        ["2025-02-10", 4.4],
        ["2025-05-01", 5.6],
        ["2025-08-01", 4.9],
        ["2025-11-10", 4.7],
        ["2026-04-20", 4.8],
      ],
    }),
    ...labSeries({
      key: "creatinine",
      display: "Creatinine",
      loinc: "2160-0",
      unit: "mg/dL",
      low: 0.5,
      high: 1.1,
      points: [
        ["2025-02-10", 1.42],
        ["2025-05-01", 1.56],
        ["2025-08-01", 1.68],
        ["2025-11-10", 1.61],
        ["2026-03-02", 1.48],
      ],
    }),
    ...labSeries({
      key: "ntprobnp",
      display: "NT-proBNP",
      loinc: "33762-6",
      unit: "pg/mL",
      low: 0,
      high: 125,
      points: [
        ["2025-03-24", 1280],
        ["2025-05-01", 940],
        ["2025-08-01", 720],
        ["2025-11-10", 610],
        ["2026-03-02", 830],
      ],
    }),
    ...labSeries({
      key: "ldl",
      display: "LDL Cholesterol",
      loinc: "18262-6",
      unit: "mg/dL",
      low: 0,
      high: 100,
      points: [
        ["2025-02-10", 142],
        ["2025-05-01", 118],
        ["2025-08-01", 101],
        ["2025-11-10", 92],
        ["2026-03-02", 88],
      ],
    }),
    ...labSeries({
      key: "hemoglobin",
      display: "Hemoglobin",
      loinc: "718-7",
      unit: "g/dL",
      low: 12,
      high: 16,
      points: [
        ["2025-02-10", 12.2],
        ["2025-05-01", 11.8],
        ["2025-08-01", 11.4],
        ["2025-11-10", 11.6],
        ["2026-03-02", 11.9],
      ],
    }),
    ...labSeries({
      key: "albumin",
      display: "Albumin",
      loinc: "1751-7",
      unit: "g/dL",
      low: 3.5,
      high: 5,
      points: [
        ["2025-02-10", 3.8],
        ["2025-05-01", 3.6],
        ["2025-08-01", 3.4],
        ["2025-11-10", 3.7],
        ["2026-03-02", 3.9],
      ],
    }),
  ];

  return resources.map((resource) => JSON.parse(JSON.stringify(resource)));
}

function buildTransactionBundle() {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: buildResources().map((resource) => ({
      fullUrl: `urn:uuid:${resource.resourceType}-${resource.id}`,
      resource,
      request: {
        method: "PUT",
        url: `${resource.resourceType}/${resource.id}`,
      },
    })),
  };
}

function summarize(bundle) {
  const counts = {};
  for (const entry of bundle.entry ?? []) {
    const type = entry.resource?.resourceType ?? "Unknown";
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

async function fetchWithTimeout(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 1200) };
  }
}

async function checkServer() {
  process.stdout.write(`${dim("GET")} ${FHIR_SERVER_URL}/metadata ... `);
  const res = await fetchWithTimeout(`${FHIR_SERVER_URL}/metadata`, {
    headers: { Accept: "application/fhir+json" },
  });
  if (!res.ok) {
    console.log(red(`HTTP ${res.status}`));
    throw new Error(`FHIR server metadata failed with HTTP ${res.status}`);
  }
  const cap = await res.json();
  console.log(green("OK"));
  console.log(
    `  ${dim("server:")} ${cap.software?.name ?? "?"} ${cap.software?.version ?? ""} ${dim("fhirVersion:")} ${cap.fhirVersion ?? "?"}`,
  );
}

async function postBundle(bundle) {
  process.stdout.write(
    `${dim("POST")} ${FHIR_SERVER_URL}/ ${dim(`transaction, ${bundle.entry.length} entries`)} ... `,
  );
  const res = await fetchWithTimeout(`${FHIR_SERVER_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/fhir+json",
      Accept: "application/fhir+json",
    },
    body: JSON.stringify(bundle),
  });
  const parsed = await readJsonResponse(res);
  if (!res.ok) {
    console.log(red(`HTTP ${res.status}`));
    console.error(JSON.stringify(parsed, null, 2));
    throw new Error("Showcase bundle transaction failed");
  }
  console.log(green(`HTTP ${res.status}`));
  return parsed;
}

function reportEntryResults(response) {
  let ok = 0;
  let bad = 0;
  const failures = [];
  for (const entry of response?.entry ?? []) {
    const status = entry.response?.status ?? "";
    const code = Number.parseInt(status.split(" ")[0] ?? "", 10);
    if (Number.isFinite(code) && code >= 200 && code < 300) {
      ok += 1;
    } else {
      bad += 1;
      failures.push(`${status || "missing status"} ${entry.response?.location ?? ""}`.trim());
    }
  }
  if (bad) {
    for (const failure of failures) console.log(`  ${red("x")} ${failure}`);
    throw new Error(`${bad} transaction entries failed`);
  }
  console.log(`  ${green(String(ok))} entries OK`);
}

async function searchCount(label, query, expectMin) {
  const joiner = query.includes("?") ? "&" : "?";
  const countedQuery = query.includes("_count=") ? query : `${query}${joiner}_count=200`;
  const url = `${FHIR_SERVER_URL}/${countedQuery}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/fhir+json" } });
  if (!res.ok) {
    console.log(`  ${red("x")} ${label}: HTTP ${res.status}`);
    return false;
  }
  const bundle = await res.json();
  const got = typeof bundle.total === "number" ? bundle.total : (bundle.entry?.length ?? 0);
  const ok = got >= expectMin;
  console.log(`  ${ok ? green("OK") : red("BAD")} ${label}: ${got} ${dim(`expected >= ${expectMin}`)}`);
  return ok;
}

async function verifyFhirResources() {
  process.stdout.write(`${dim("GET")} ${FHIR_SERVER_URL}/Patient/${PATIENT_ID} ... `);
  const patientRes = await fetchWithTimeout(`${FHIR_SERVER_URL}/Patient/${PATIENT_ID}`, {
    headers: { Accept: "application/fhir+json" },
  });
  if (!patientRes.ok) {
    console.log(red(`HTTP ${patientRes.status}`));
    return false;
  }
  const p = await patientRes.json();
  const display = `${p.name?.[0]?.given?.join(" ") ?? ""} ${p.name?.[0]?.family ?? ""}`.trim();
  console.log(green("OK"));
  console.log(`  ${dim("patient:")} ${p.id} ${dim("display:")} ${display}`);

  const checks = [];
  checks.push(await searchCount("allergies", `AllergyIntolerance?patient=${PATIENT_ID}`, 3));
  checks.push(
    await searchCount("active medications", `MedicationRequest?patient=${PATIENT_ID}&status=active`, 12),
  );
  checks.push(
    await searchCount("active problems", `Condition?patient=${PATIENT_ID}&clinical-status=active`, 9),
  );
  checks.push(await searchCount("immunizations", `Immunization?patient=${PATIENT_ID}`, 5));
  checks.push(
    await searchCount("laboratory observations", `Observation?patient=${PATIENT_ID}&category=laboratory`, 40),
  );
  checks.push(await searchCount("encounters", `Encounter?patient=${PATIENT_ID}`, 10));
  return checks.every(Boolean);
}

async function verifyLiveMcp() {
  if (process.env.SKIP_LIVE_MCP === "1") {
    console.log(yellow("Skipping live MCP verification because SKIP_LIVE_MCP=1."));
    return;
  }

  process.stdout.write(`${dim("MCP")} visualize_patient_dashboard via deployed Worker ... `);
  const res = await fetchWithTimeout(LIVE_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-FHIR-Server-URL": FHIR_SERVER_URL,
      "X-FHIR-Access-Token": "anonymous",
      "X-Patient-ID": PATIENT_ID,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "showcase-dashboard",
      method: "tools/call",
      params: {
        name: "visualize_patient_dashboard",
        arguments: {
          patient_id: PATIENT_ID,
          include_charts: true,
          lab_lookback_days: 1095,
        },
      },
    }),
  });
  const json = await readJsonResponse(res);
  if (!res.ok || json?.error) {
    console.log(red(`HTTP ${res.status}`));
    console.error(JSON.stringify(json, null, 2));
    throw new Error("Live MCP verification failed");
  }
  const result = json.result ?? {};
  const summary = result.data_summary ?? {};
  const ui = result.content?.find?.((item) => item.type === "resource" && item.resource?.uri);
  const good =
    result.patient_name === PATIENT_DISPLAY &&
    summary.allergies >= 3 &&
    summary.medications >= 12 &&
    summary.problems >= 9 &&
    summary.labs >= 40 &&
    summary.encounters >= 10 &&
    ui?.resource?.uri?.startsWith("ui://");

  console.log(good ? green("OK") : red("BAD"));
  console.log(`  ${dim("patient:")} ${result.patient_name ?? "(missing)"}`);
  console.log(`  ${dim("ui:")} ${ui?.resource?.uri ?? "(missing)"}`);
  console.log(`  ${dim("summary:")} ${JSON.stringify(summary)}`);
  console.log(`  ${dim("alerts:")} ${result.alerts_count ?? 0}`);

  if (!good) throw new Error("Live MCP returned an incomplete showcase dashboard");
}

async function main() {
  const bundle = buildTransactionBundle();
  console.log("");
  console.log(`${green("Featherless showcase patient loader")} ${dim(`target: ${FHIR_SERVER_URL}`)}`);
  console.log(`${dim("patient:")} ${PATIENT_ID} (${PATIENT_DISPLAY})`);
  console.log("");
  console.log(dim("Bundle resource counts:"));
  for (const [type, count] of Object.entries(summarize(bundle)).sort()) {
    console.log(`  ${type}: ${count}`);
  }
  console.log("");

  await checkServer();
  const response = await postBundle(bundle);
  reportEntryResults(response);

  console.log("");
  console.log(dim("FHIR verification:"));
  const ok = await verifyFhirResources();
  if (!ok) throw new Error("FHIR verification failed");

  console.log("");
  await verifyLiveMcp();

  console.log("");
  console.log(green("Showcase patient is ready."));
  console.log(`  Patient ID: ${PATIENT_ID}`);
  console.log(`  FHIR server: ${FHIR_SERVER_URL}`);
  console.log("");
  console.log("Agent Zero demo prompt:");
  console.log(
    `  Show me the Featherless MCP-UI dashboard for Elena Carter, patient_id ${PATIENT_ID}. Use FHIR server ${FHIR_SERVER_URL}, token anonymous, include charts, and use a 1095 day lab lookback.`,
  );
  console.log("");
}

main().catch((error) => {
  console.error("");
  console.error(red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

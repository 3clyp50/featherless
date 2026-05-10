/**
 * scripts/load-hero.ts
 *
 * Load the Mrs. María Garcia hero bundle into a FHIR R4 server (default:
 * local HAPI Docker at http://localhost:8080/fhir).
 *
 * Usage:
 *   docker run -p 8080:8080 hapiproject/hapi:latest   # in a separate terminal
 *   npx tsx scripts/load-hero.ts                      # load + verify
 *   FHIR_SERVER_URL=https://my-fhir.example/r4 npx tsx scripts/load-hero.ts
 *
 * The bundle uses `request.method = "PUT"` per entry, so this script is
 * idempotent — re-running updates the existing resources in place. Judges
 * can clone the repo, spin up HAPI, and re-load deterministically.
 *
 * Exit codes:
 *   0  bundle loaded, Patient/hapi-garcia-maria readable
 *   1  HAPI unreachable, bundle malformed, or any entry returned >=400
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Config ─────────────────────────────────────────────────────────────────────

const FHIR_SERVER_URL = (process.env.FHIR_SERVER_URL ?? "http://localhost:8080/fhir").replace(
  /\/+$/,
  "",
);
const PATIENT_ID = "hapi-garcia-maria";
const TIMEOUT_MS = 30_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = resolve(HERE, "hero-bundle.json");

// ── Types ──────────────────────────────────────────────────────────────────────

interface BundleEntry {
  fullUrl?: string;
  resource?: { resourceType: string; id?: string };
  request?: { method?: string; url?: string };
  response?: { status?: string; location?: string; outcome?: unknown };
}
interface FhirBundle {
  resourceType: "Bundle";
  type: string;
  entry?: BundleEntry[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function color(code: string, text: string): string {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (t: string) => color("32", t);
const red = (t: string) => color("31", t);
const yellow = (t: string) => color("33", t);
const dim = (t: string) => color("2", t);

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function summariseEntries(bundle: FhirBundle): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of bundle.entry ?? []) {
    const t = e.resource?.resourceType ?? "Unknown";
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

// ── Steps ──────────────────────────────────────────────────────────────────────

async function checkServer(): Promise<void> {
  process.stdout.write(`${dim("→")} GET ${FHIR_SERVER_URL}/metadata ... `);
  let res: Response;
  try {
    res = await fetchWithTimeout(`${FHIR_SERVER_URL}/metadata`, {
      headers: { Accept: "application/fhir+json" },
    });
  } catch (e) {
    console.log(red("FAIL"));
    console.error(red(`  Cannot reach FHIR server at ${FHIR_SERVER_URL}.`));
    console.error(red(`  ${e instanceof Error ? e.message : String(e)}`));
    console.error(yellow("  Hint: `docker run -p 8080:8080 hapiproject/hapi:latest`"));
    process.exit(1);
  }
  if (!res.ok) {
    console.log(red(`HTTP ${res.status}`));
    console.error(red(`  Server is up but /metadata returned ${res.status}. Aborting.`));
    process.exit(1);
  }
  const cap = (await res.json()) as {
    fhirVersion?: string;
    software?: { name?: string; version?: string };
  };
  console.log(green("OK"));
  console.log(
    `  ${dim("server:")} ${cap.software?.name ?? "?"} ${cap.software?.version ?? ""}  ${dim("fhirVersion:")} ${cap.fhirVersion ?? "?"}`,
  );
}

async function postBundle(bundle: FhirBundle): Promise<FhirBundle> {
  process.stdout.write(
    `${dim("→")} POST ${FHIR_SERVER_URL}/  ${dim(`(transaction · ${bundle.entry?.length ?? 0} entries)`)} ... `,
  );
  const res = await fetchWithTimeout(`${FHIR_SERVER_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/fhir+json",
      Accept: "application/fhir+json",
    },
    body: JSON.stringify(bundle),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { _raw: text.slice(0, 800) };
    }
  }
  if (!res.ok) {
    console.log(red(`HTTP ${res.status}`));
    console.error(red("  Bundle POST failed:"));
    console.error(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }
  console.log(green(`HTTP ${res.status}`));
  return parsed as FhirBundle;
}

function reportEntryResults(response: FhirBundle): { ok: number; bad: number } {
  let ok = 0;
  let bad = 0;
  const failures: string[] = [];
  for (const e of response.entry ?? []) {
    const status = e.response?.status ?? "";
    const code = Number.parseInt(status.split(" ")[0] ?? "", 10);
    const target = e.response?.location ?? "(unknown)";
    if (Number.isFinite(code) && code >= 200 && code < 300) {
      ok += 1;
    } else {
      bad += 1;
      failures.push(`  ${red("✗")} ${status}  ${target}`);
    }
  }
  if (bad > 0) {
    console.log(red(`  ${bad} entries failed:`));
    for (const f of failures) console.log(f);
  }
  return { ok, bad };
}

async function verifyPatient(): Promise<void> {
  const url = `${FHIR_SERVER_URL}/Patient/${PATIENT_ID}`;
  process.stdout.write(`${dim("→")} GET ${url} ... `);
  const res = await fetchWithTimeout(url, {
    headers: { Accept: "application/fhir+json" },
  });
  if (!res.ok) {
    console.log(red(`HTTP ${res.status}`));
    process.exit(1);
  }
  const patient = (await res.json()) as {
    resourceType?: string;
    id?: string;
    name?: { family?: string; given?: string[] }[];
    birthDate?: string;
  };
  const name = patient.name?.[0];
  const display = name
    ? `${(name.given ?? []).join(" ")} ${name.family ?? ""}`.trim()
    : "(no name)";
  console.log(green("OK"));
  console.log(`  ${dim("patient:")} ${patient.id} · ${display} · DOB ${patient.birthDate ?? "?"}`);
}

async function verifyEverything(): Promise<void> {
  // Quick "did the related resources land?" — query Conditions + MedicationRequests
  // for the patient. Not a full $everything (HAPI in default config doesn't enable it).
  const queries: { label: string; url: string; expectMin: number }[] = [
    {
      label: "active conditions",
      url: `Condition?patient=${PATIENT_ID}&clinical-status=active`,
      expectMin: 5,
    },
    {
      label: "active medications",
      url: `MedicationRequest?patient=${PATIENT_ID}&status=active`,
      expectMin: 6,
    },
    { label: "service requests", url: `ServiceRequest?patient=${PATIENT_ID}`, expectMin: 3 },
    {
      label: "vital-signs observations",
      url: `Observation?patient=${PATIENT_ID}&category=vital-signs`,
      expectMin: 3,
    },
    {
      label: "lab observations",
      url: `Observation?patient=${PATIENT_ID}&category=laboratory`,
      expectMin: 3,
    },
    { label: "encounters", url: `Encounter?patient=${PATIENT_ID}`, expectMin: 1 },
    { label: "appointments", url: `Appointment?patient=${PATIENT_ID}`, expectMin: 1 },
    { label: "document references", url: `DocumentReference?patient=${PATIENT_ID}`, expectMin: 1 },
  ];
  let allGood = true;
  for (const q of queries) {
    const res = await fetchWithTimeout(`${FHIR_SERVER_URL}/${q.url}`, {
      headers: { Accept: "application/fhir+json" },
    });
    if (!res.ok) {
      console.log(`  ${red("✗")} ${q.label}: HTTP ${res.status}`);
      allGood = false;
      continue;
    }
    const bundle = (await res.json()) as { total?: number; entry?: unknown[] };
    const got = typeof bundle.total === "number" ? bundle.total : (bundle.entry?.length ?? 0);
    const ok = got >= q.expectMin;
    if (!ok) allGood = false;
    console.log(
      `  ${ok ? green("✓") : red("✗")} ${q.label}: ${got} ${dim(`(expected ≥${q.expectMin})`)}`,
    );
  }
  if (!allGood) {
    console.error(red("\nVerification failed — some expected resources are missing."));
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${green("Featherless · hero-bundle loader")}  ${dim(`→ ${FHIR_SERVER_URL}`)}\n`);

  let bundle: FhirBundle;
  try {
    bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf-8")) as FhirBundle;
  } catch (e) {
    console.error(
      red(`Cannot read bundle at ${BUNDLE_PATH}: ${e instanceof Error ? e.message : String(e)}`),
    );
    process.exit(1);
  }
  if (bundle.resourceType !== "Bundle" || bundle.type !== "transaction") {
    console.error(red(`Bundle at ${BUNDLE_PATH} is not a transaction Bundle.`));
    process.exit(1);
  }

  console.log(dim("Bundle resource counts:"));
  for (const [t, n] of Object.entries(summariseEntries(bundle)).sort()) {
    console.log(`  ${t}: ${n}`);
  }
  console.log();

  await checkServer();
  const response = await postBundle(bundle);
  const { ok, bad } = reportEntryResults(response);
  console.log(`  ${ok} entries OK${bad ? `, ${red(`${String(bad)} failed`)}` : ""}`);
  if (bad > 0) process.exit(1);

  console.log();
  console.log(dim("Verification:"));
  await verifyPatient();
  await verifyEverything();

  console.log(`\n${green("✓ hero patient loaded")}  ${dim(`Patient/${PATIENT_ID}`)}\n`);
  console.log("Next:  point the Worker at this server with");
  console.log(
    `       ${dim(`FHIR_SERVER_URL=${FHIR_SERVER_URL} FEATHERLESS_DEV_MODE=1 PATIENT_ID=${PATIENT_ID} npm run dev`)}\n`,
  );
}

main().catch((e) => {
  console.error(
    red(`\nUnexpected error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`),
  );
  process.exit(1);
});

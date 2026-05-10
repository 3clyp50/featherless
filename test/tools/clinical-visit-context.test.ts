/**
 * Integration test for the visit-scoped clinical context packer.
 *
 * Drives the registered MCP tool (`clinical_pack_visit_context`) over the
 * Worker's `/mcp` JSON-RPC surface using `@cloudflare/vitest-pool-workers`'
 * `SELF` binding. FHIR upstream is local HAPI Docker with the hero bundle
 * loaded (see `scripts/load-hero.ts`). If local HAPI isn't reachable, the
 * test calls `console.warn` and returns early — same forgiving pattern as
 * the substrate's e2e suite.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { visitContextOutputSchema } from "../../src/tools/schemas/visit-context.ts";

const HAPI_LOCAL = "http://127.0.0.1:8080/fhir";
const HERO_PATIENT = "hapi-garcia-maria";
const HERO_ENCOUNTER = "enc-2026-05-05-cardiology-fu";
const OLD_VISIT_PATIENT = "hapi-old-visit-fallback";
const OLD_VISIT_ENCOUNTER = "enc-old-visit-fallback";
const DAY_MS = 86_400_000;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

async function rpc(
  method: string,
  params?: unknown,
  headers?: Record<string, string>,
): Promise<JsonRpcResponse> {
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const res = await SELF.fetch("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as JsonRpcResponse;
}

const sharpHeaders = {
  "X-FHIR-Server-URL": HAPI_LOCAL,
  "X-FHIR-Access-Token": "anonymous",
  "X-Patient-ID": HERO_PATIENT,
};

function daysAgoDateOnly(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

async function putFhirFixture(
  resourceType: string,
  id: string,
  resource: unknown,
): Promise<boolean> {
  const res = await fetch(`${HAPI_LOCAL}/${resourceType}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/fhir+json" },
    body: JSON.stringify(resource),
  });
  return res.ok;
}

async function seedOldEncounterFixture(): Promise<{ seeded: boolean; encounterDate: string }> {
  const encounterDate = daysAgoDateOnly(180);
  try {
    const probe = await fetch(`${HAPI_LOCAL}/metadata`);
    if (!probe.ok) return { seeded: false, encounterDate };

    const patient = {
      resourceType: "Patient",
      id: OLD_VISIT_PATIENT,
      name: [{ family: "Fallback", given: ["Nora"] }],
      birthDate: "1980-01-01",
      communication: [
        {
          language: {
            coding: [{ system: "urn:ietf:bcp:47", code: "en-US", display: "English" }],
            text: "English",
          },
          preferred: true,
        },
      ],
    };
    const encounter = {
      resourceType: "Encounter",
      id: OLD_VISIT_ENCOUNTER,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "AMB",
        display: "ambulatory",
      },
      type: [{ text: "Primary care follow-up" }],
      subject: { reference: `Patient/${OLD_VISIT_PATIENT}` },
      participant: [{ individual: { display: "Dr. Ada North" } }],
      period: { start: `${encounterDate}T09:00:00Z` },
      reasonCode: [{ text: "Follow-up visit" }],
    };

    const patientOk = await putFhirFixture("Patient", OLD_VISIT_PATIENT, patient);
    const encounterOk = await putFhirFixture("Encounter", OLD_VISIT_ENCOUNTER, encounter);
    return { seeded: patientOk && encounterOk, encounterDate };
  } catch {
    return { seeded: false, encounterDate };
  }
}

function looksLikeUnreachableUpstream(structured: unknown): boolean {
  if (!structured || typeof structured !== "object") return false;
  const err = (structured as { error?: unknown }).error;
  return err === "fhir_error";
}

describe("clinical_pack_visit_context", () => {
  it("appears in tools/list", async () => {
    const r = await rpc("tools/list");
    const tools = (r.result as { tools: { name: string }[] }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("clinical_pack_visit_context");
  });

  it("returns the §7 envelope for the hero patient with furosemide as the new med", async () => {
    const r = await rpc(
      "tools/call",
      { name: "clinical_pack_visit_context", arguments: { encounter_id: HERO_ENCOUNTER } },
      sharpHeaders,
    );
    const probe = (r.result as { structuredContent?: unknown }).structuredContent;
    if (looksLikeUnreachableUpstream(probe)) {
      console.warn(
        `local HAPI not reachable at ${HAPI_LOCAL}/Patient/${HERO_PATIENT} — skipping. Run \`docker run -p 8080:8080 hapiproject/hapi:latest\` and \`npx tsx scripts/load-hero.ts\`.`,
      );
      return;
    }
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    const result = r.result as {
      structuredContent?: unknown;
      content?: { text?: string }[];
    };
    expect(result.structuredContent, JSON.stringify(result.content?.[0]?.text)).toBeDefined();

    const parsed = visitContextOutputSchema.safeParse(result.structuredContent);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format())).toBe(true);
    if (!parsed.success) return;
    const ctx = parsed.data;

    // Patient block — María García, es-US, age 67 (DOB 1958-09-14 → on 2026-05-10 she's 67).
    expect(ctx.patient.id).toBe(HERO_PATIENT);
    expect(ctx.patient.name).toMatch(/Garc[ií]a/i);
    expect(ctx.patient.preferred_language).toMatch(/^es/i);
    expect(ctx.patient.reading_level_target).toBe("grade-6-es");
    expect(ctx.patient.age).toBe(67);

    // Encounter — today's cardiology follow-up.
    expect(ctx.encounter.id).toBe(HERO_ENCOUNTER);
    expect(ctx.encounter.date).toBe("2026-05-05");
    expect(ctx.encounter.type).toMatch(/cardiology/i);
    expect(ctx.encounter.provider).toMatch(/Chen/);

    // Active problems — 5 from the hero bundle (HFrEF, T2DM, HTN, CKD3a, HLD).
    expect(ctx.active_problems.length).toBe(5);

    // Medication changes — 6 active meds; furosemide is the only "new" one (authoredOn 2026-05-05).
    expect(ctx.medication_changes.length).toBe(6);
    const newMed = ctx.medication_changes.find((m) => m.action === "new");
    expect(newMed, "expected one new medication entry").toBeDefined();
    expect(newMed?.name.toLowerCase()).toContain("furosemide");
    const newCount = ctx.medication_changes.filter((m) => m.action === "new").length;
    expect(newCount).toBe(1);

    // Orders — 3 ServiceRequests (BMP, BNP, echo) + 1 Appointment (8-week follow-up) = 4.
    expect(ctx.orders.length).toBe(4);
    const orderTypes = new Set(ctx.orders.map((o) => o.type));
    expect(orderTypes.has("lab")).toBe(true);
    expect(orderTypes.has("imaging")).toBe(true);
    expect(orderTypes.has("appointment")).toBe(true);

    // Vitals — BP 128/76, HR 72, weight delta -1.8 kg.
    expect(ctx.vitals_today.bp).toBe("128/76");
    expect(ctx.vitals_today.hr).toBe(72);
    expect(ctx.vitals_today.weight_change_kg).toBeCloseTo(-1.8, 1);

    // Key labs — eGFR 52, K+ 4.4, A1c 7.8.
    expect(ctx.key_labs_recent.egfr).toBe(52);
    expect(ctx.key_labs_recent.k).toBeCloseTo(4.4, 2);
    expect(ctx.key_labs_recent.a1c).toBeCloseTo(7.8, 2);

    // Clinician summary — base64-decoded from DocumentReference.
    expect(ctx.clinician_summary, "expected note text").toBeDefined();
    expect(ctx.clinician_summary ?? "").toMatch(/HFrEF|metoprolol|furosemide/i);
  }, 30_000);

  it("falls back to older encounters when no recent encounter is available", async () => {
    const { seeded, encounterDate } = await seedOldEncounterFixture();
    if (!seeded) {
      console.warn(
        `local HAPI not reachable or not writable at ${HAPI_LOCAL} — skipping older-encounter fallback test.`,
      );
      return;
    }

    const r = await rpc(
      "tools/call",
      { name: "clinical_pack_visit_context", arguments: {} },
      { ...sharpHeaders, "X-Patient-ID": OLD_VISIT_PATIENT },
    );
    const probe = (r.result as { structuredContent?: unknown }).structuredContent;
    if (looksLikeUnreachableUpstream(probe)) {
      console.warn(
        `local HAPI not reachable at ${HAPI_LOCAL}/Patient/${OLD_VISIT_PATIENT} — skipping.`,
      );
      return;
    }
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();

    const result = r.result as {
      structuredContent?: unknown;
      content?: { text?: string }[];
    };
    const parsed = visitContextOutputSchema.safeParse(result.structuredContent);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format())).toBe(true);
    if (!parsed.success) return;

    const ctx = parsed.data;
    expect(ctx.patient.id).toBe(OLD_VISIT_PATIENT);
    expect(ctx.patient.name).toMatch(/Fallback/i);
    expect(ctx.patient.reading_level_target).toBe("grade-6-en");
    expect(ctx.encounter.id).toBe(OLD_VISIT_ENCOUNTER);
    expect(ctx.encounter.date).toBe(encounterDate);
    expect(ctx.encounter.provider).toBe("Dr. Ada North");
  }, 30_000);

  it("honors an older explicit encounter_id without first returning no_encounter_found", async () => {
    const { seeded, encounterDate } = await seedOldEncounterFixture();
    if (!seeded) {
      console.warn(
        `local HAPI not reachable or not writable at ${HAPI_LOCAL} — skipping explicit older-encounter test.`,
      );
      return;
    }

    const r = await rpc(
      "tools/call",
      {
        name: "clinical_pack_visit_context",
        arguments: { encounter_id: OLD_VISIT_ENCOUNTER },
      },
      { ...sharpHeaders, "X-Patient-ID": OLD_VISIT_PATIENT },
    );
    const probe = (r.result as { structuredContent?: unknown }).structuredContent;
    if (looksLikeUnreachableUpstream(probe)) {
      console.warn(
        `local HAPI not reachable at ${HAPI_LOCAL}/Patient/${OLD_VISIT_PATIENT} — skipping.`,
      );
      return;
    }
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();

    const result = r.result as {
      structuredContent?: unknown;
      content?: { text?: string }[];
    };
    const parsed = visitContextOutputSchema.safeParse(result.structuredContent);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format())).toBe(true);
    if (!parsed.success) return;

    const ctx = parsed.data;
    expect(ctx.patient.id).toBe(OLD_VISIT_PATIENT);
    expect(ctx.encounter.id).toBe(OLD_VISIT_ENCOUNTER);
    expect(ctx.encounter.date).toBe(encounterDate);
    expect(ctx.encounter.provider).toBe("Dr. Ada North");
  }, 30_000);

  it("returns fhir_context_required envelope when SHARP headers are absent", async () => {
    const r = await rpc("tools/call", {
      name: "clinical_pack_visit_context",
      arguments: {},
    });
    const result = r.result as { structuredContent?: { error?: string } };
    expect(result.structuredContent?.error).toBe("fhir_context_required");
  });
});

/**
 * FHIRClient tests — hits local synthetic HAPI R4. No mocks.
 *
 * Load the hero bundle with `npx tsx scripts/load-hero.ts`.
 */
import { describe, expect, it } from "vitest";
import { FHIRClient, FHIRError } from "../src/clients/fhir-client.ts";

const HAPI = "http://127.0.0.1:8080/fhir";

describe("FHIRClient against local HAPI", () => {
  it("fetches CapabilityStatement", async () => {
    const fhir = new FHIRClient({ baseUrl: HAPI });
    const cap = await fhir.getCapabilityStatement();
    expect(cap.resourceType).toBe("CapabilityStatement");
    expect(cap.fhirVersion).toMatch(/^4\./);
  });

  it("returns an OperationOutcome-bearing FHIRError for a 404", async () => {
    const fhir = new FHIRClient({ baseUrl: HAPI });
    let caught: unknown;
    try {
      await fhir.getResource("Patient", "this-patient-definitely-does-not-exist-9999999999");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FHIRError);
    if (caught instanceof FHIRError) {
      expect(caught.statusCode).toBe(404);
      expect(caught.detail).toBeTypeOf("object");
    }
  });

  it("searches Patient with a name filter and returns a Bundle", async () => {
    const fhir = new FHIRClient({ baseUrl: HAPI });
    const bundle = await fhir.searchPatients({ name: "Garcia", count: 5 });
    expect(bundle.resourceType).toBe("Bundle");
    expect(Array.isArray(bundle.entry ?? [])).toBe(true);
  });
});

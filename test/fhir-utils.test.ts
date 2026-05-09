/**
 * Pure-function tests — no I/O. Verifies the FHIR normalisers handle real
 * and partial / malformed shapes without throwing.
 */
import { describe, expect, it } from "vitest";
import {
  allergySummary,
  bundleNextLink,
  bundleToResources,
  bundleTotal,
  calculateAge,
  codingText,
  conditionSummary,
  encounterSummary,
  observationSummary,
  patientDisplayName,
  patientSummary,
} from "../src/fhir-utils.ts";

describe("bundle helpers", () => {
  it("handles missing / null bundles", () => {
    expect(bundleToResources(null)).toEqual([]);
    expect(bundleTotal(null)).toBe(0);
    expect(bundleNextLink(null)).toBeNull();
  });

  it("falls back to entry length when total absent", () => {
    expect(bundleTotal({ entry: [{}, {}, {}] } as never)).toBe(3);
    expect(bundleTotal({ total: 7, entry: [{}] } as never)).toBe(7);
  });

  it("returns next link when present", () => {
    const bundle = {
      link: [
        { relation: "self", url: "x" },
        { relation: "next", url: "https://example.com/?_offset=10" },
      ],
    };
    expect(bundleNextLink(bundle as never)).toBe("https://example.com/?_offset=10");
  });
});

describe("codingText", () => {
  it("prefers text, then display, then code", () => {
    expect(codingText({ text: "Hypertension" })).toBe("Hypertension");
    expect(codingText({ coding: [{ display: "Hypertension" }] })).toBe("Hypertension");
    expect(codingText({ coding: [{ code: "I10" }] })).toBe("I10");
    expect(codingText(null)).toBe("");
    expect(codingText({})).toBe("");
  });
});

describe("patientDisplayName / patientSummary", () => {
  const patient = {
    id: "abc",
    name: [
      { use: "official", given: ["Jane", "Q"], family: "Doe" },
      { use: "nickname", text: "JD" },
    ],
    birthDate: "1980-04-15",
    gender: "female",
    telecom: [
      { system: "phone", value: "+1 555 123 4567" },
      { system: "email", value: "jane@example.com" },
    ],
    address: [{ line: ["1 Main St"], city: "Boston", state: "MA", postalCode: "02101" }],
    active: true,
  };

  it("picks the official name", () => {
    expect(patientDisplayName(patient)).toBe("Jane Q Doe");
  });

  it("summarises everything we care about", () => {
    const summary = patientSummary(patient);
    expect(summary.id).toBe("abc");
    expect(summary.name).toBe("Jane Q Doe");
    expect(summary.gender).toBe("female");
    expect(summary.date_of_birth).toBe("1980-04-15");
    expect(summary.phone).toBe("+1 555 123 4567");
    expect(summary.email).toBe("jane@example.com");
    expect(summary.address).toContain("Boston");
    expect(summary.active).toBe(true);
    expect(typeof summary.age).toBe("number");
  });

  it("falls back to Patient/<id> when no name", () => {
    expect(patientDisplayName({ id: "x9" })).toBe("Patient/x9");
  });
});

describe("calculateAge", () => {
  it("computes a sensible age", () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
    const dob = tenYearsAgo.toISOString().slice(0, 10);
    const age = calculateAge(dob);
    // Allow ±1 for birthday edge cases on the same calendar day
    expect(age === 10 || age === 9).toBe(true);
  });

  it("handles partial / null / malformed input", () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge("")).toBeNull();
    expect(calculateAge("not a date")).toBeNull();
    expect(typeof calculateAge("1990")).toBe("number");
  });
});

describe("observationSummary", () => {
  it("extracts numeric value, unit, abnormal flag, LOINC", () => {
    const obs = {
      id: "o1",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2339-0", display: "Glucose" }] },
      valueQuantity: { value: 188, unit: "mg/dL" },
      interpretation: [{ coding: [{ code: "H" }] }],
      referenceRange: [{ low: { value: 70, unit: "mg/dL" }, high: { value: 99, unit: "mg/dL" } }],
      effectiveDateTime: "2025-03-01T10:00:00Z",
    };
    const s = observationSummary(obs);
    expect(s.test).toBe("Glucose");
    expect(s.loinc).toBe("2339-0");
    expect(s.value).toBe(188);
    expect(s.unit).toBe("mg/dL");
    expect(s.normal_range).toContain("70");
    expect(s.normal_range).toContain("99");
    expect(s.abnormal).toBe(true);
  });

  it("does not throw on a sparse Observation", () => {
    expect(() => observationSummary({ id: "o2", status: "preliminary" })).not.toThrow();
  });
});

describe("conditionSummary / allergySummary / encounterSummary", () => {
  it("handles minimal inputs without throwing", () => {
    expect(() => conditionSummary({ id: "c1" })).not.toThrow();
    expect(() => allergySummary({ id: "a1" })).not.toThrow();
    expect(() => encounterSummary({ id: "e1" })).not.toThrow();
  });
});

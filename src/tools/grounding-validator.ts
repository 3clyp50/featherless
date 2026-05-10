import type { VisitContext } from "./schemas/visit-context.ts";

export const DEFAULT_ALLOWED_CITATION_IDS = [
  "CIT-001",
  "CIT-002",
  "CIT-003",
  "CIT-004",
  "CIT-005",
  "CIT-006",
  "CIT-007",
  "CIT-008",
  "CIT-009",
  "CIT-010",
] as const;

export const CITATION_SNIPPETS: Record<string, string> = {
  "CIT-001":
    "AHRQ plain-language materials should use common words, short sentences, active voice, direct organization, and focus on what the patient must do.",
  "CIT-002":
    "AHRQ PEMAT evaluates patient education materials for understandability and actionability; scores of at least 70 percent are used as a patient-ready benchmark.",
  "CIT-003":
    "Patients forget or misremember a substantial portion of medical information provided during clinical encounters.",
  "CIT-004":
    "Patients may misunderstand discharge instructions and may not realize that they have not understood a care instruction.",
  "CIT-005":
    "CDC clear communication guidance emphasizes the main message, clear calls to action, and behavioral recommendations.",
  "CIT-006":
    "AHRQ discharge process guidance emphasizes medication clarity, follow-up instructions, return precautions, and contact information.",
  "CIT-007":
    "Joint Commission discharge standards expect care transitions to reflect the patient's assessed needs.",
  "CIT-008":
    "CMS discharge planning requirements emphasize safe transitions and patient-relevant follow-up planning.",
  "CIT-009":
    "HL7 FHIR R4 defines the healthcare resource shapes used for read and write workflows.",
  "CIT-010":
    "SHARP-on-MCP defines stateless healthcare context propagation with X-FHIR-Server-URL, X-FHIR-Access-Token, and X-Patient-ID headers.",
};

export interface GroundingValidationInput {
  text: string;
  visit_context: VisitContext;
  allowed_citation_ids?: string[];
  citations_used?: string[];
}

export interface GroundingValidationResult {
  ok: boolean;
  citations_used: string[];
  unapproved_citations: string[];
  unsupported_quotes: string[];
  unknown_doses: string[];
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function wordCount(text: string): number {
  return normalize(text).split(/\s+/).filter(Boolean).length;
}

function extractQuotedPhrases(text: string): string[] {
  const out: string[] = [];
  const re = /["“”]([^"“”]{1,800})["“”]/g;
  let match = re.exec(text);
  while (match !== null) {
    const phrase = match[1]?.trim();
    if (phrase && wordCount(phrase) >= 6) out.push(phrase);
    match = re.exec(text);
  }
  return out;
}

function extractCitationIds(text: string): string[] {
  return Array.from(new Set(text.match(/\bCIT-\d{3}\b/g) ?? []));
}

function extractDoseStrings(text: string): string[] {
  const matches = text.match(
    /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|mEq|units?)\b(?:\s*(?:po|oral|daily|bid|qhs|prn))?/gi,
  );
  return Array.from(new Set(matches ?? []));
}

function chartCorpus(visitContext: VisitContext): string {
  const medicationBits = visitContext.medication_changes
    .flatMap((m) => [m.name, m.dose, m.reason ?? "", m.behavior_rule ?? ""])
    .join(" ");
  return `${JSON.stringify(visitContext)} ${medicationBits}`;
}

function citationCorpus(ids: string[]): string {
  return ids.map((id) => CITATION_SNIPPETS[id] ?? "").join(" ");
}

export function validateGrounding(input: GroundingValidationInput): GroundingValidationResult {
  const allowed = input.allowed_citation_ids ?? [...DEFAULT_ALLOWED_CITATION_IDS];
  const citations_used = Array.from(
    new Set([...(input.citations_used ?? []), ...extractCitationIds(input.text)]),
  );
  const allowedSet = new Set(allowed);
  const unapproved_citations = citations_used.filter((id) => !allowedSet.has(id));

  const corpus = normalize(`${chartCorpus(input.visit_context)} ${citationCorpus(allowed)}`);
  const unsupported_quotes = extractQuotedPhrases(input.text).filter(
    (phrase) => !corpus.includes(normalize(phrase)),
  );

  const allowedDoseCorpus = normalize(chartCorpus(input.visit_context));
  const unknown_doses = extractDoseStrings(input.text).filter(
    (dose) => !allowedDoseCorpus.includes(normalize(dose)),
  );

  return {
    ok:
      unapproved_citations.length === 0 &&
      unsupported_quotes.length === 0 &&
      unknown_doses.length === 0,
    citations_used,
    unapproved_citations,
    unsupported_quotes,
    unknown_doses,
  };
}

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  buildTemplatePatientPacket,
  generatePatientPacket,
} from "../../src/tools/clinical-patient-packet.ts";
import { validateGrounding } from "../../src/tools/grounding-validator.ts";
import { patientPacketOutputSchema } from "../../src/tools/schemas/patient-packet.ts";
import { heroVisitContext } from "./fixtures.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

async function rpc(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const res = await SELF.fetch("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as JsonRpcResponse;
}

describe("clinical_generate_patient_packet", () => {
  it("appears in tools/list", async () => {
    const r = await rpc("tools/list");
    const tools = (r.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain("clinical_generate_patient_packet");
  });

  it("returns a config envelope when Workers AI is not bound", async () => {
    const r = await rpc("tools/call", {
      name: "clinical_generate_patient_packet",
      arguments: { visit_context: heroVisitContext },
    });
    const result = r.result as { structuredContent?: { error?: string; message?: string } };
    expect(result.structuredContent?.error).toBe("llm_config_required");
    expect(result.structuredContent?.message).toMatch(/Workers AI/);
  });

  it("generates a Spanish packet through an injected Workers AI test seam", async () => {
    const template = buildTemplatePatientPacket({ visit_context: heroVisitContext }, [
      "CIT-001",
      "CIT-005",
      "CIT-006",
    ]);
    const output = await generatePatientPacket(
      { visit_context: heroVisitContext, citation_ids: ["CIT-001", "CIT-005", "CIT-006"] },
      {
        llm: {
          async generate() {
            return { model: "@cf/test/model", text: JSON.stringify(template) };
          },
        },
        now: () => new Date("2026-05-10T00:00:00.000Z"),
      },
    );
    const parsed = patientPacketOutputSchema.safeParse(output);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format())).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.provider).toBe("workers_ai");
    expect(parsed.data.model).toBe("@cf/test/model");
    expect(parsed.data.language).toBe("es-US");
    expect(parsed.data.packet_markdown).toContain("furosemide");
    expect(parsed.data.packet_markdown).toContain("20 mg PO PRN");
    expect(parsed.data.grounding.ok).toBe(true);
    expect(parsed.data.readability.inflesz_score).toBeGreaterThan(0);
  });

  it("rejects tampered unsupported quotes and unknown doses", () => {
    const result = validateGrounding({
      visit_context: heroVisitContext,
      allowed_citation_ids: ["CIT-001"],
      citations_used: ["CIT-001", "CIT-999"],
      text: 'Tome "aspirin 81 mg every night with dinner" [CIT-999].',
    });
    expect(result.ok).toBe(false);
    expect(result.unapproved_citations).toContain("CIT-999");
    expect(result.unsupported_quotes[0]).toContain("aspirin");
    expect(result.unknown_doses).toContain("81 mg");
  });
});

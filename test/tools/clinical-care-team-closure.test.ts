import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildCareTeamClosureResources } from "../../src/tools/clinical-care-team-closure.ts";
import { careTeamClosureOutputSchema } from "../../src/tools/schemas/care-team-closure.ts";
import { heroVisitContext } from "./fixtures.ts";

const HAPI_LOCAL = "http://127.0.0.1:8080/fhir";
const HERO_PATIENT = "hapi-garcia-maria";

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
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
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

describe("clinical_prepare_care_team_closure", () => {
  it("appears in tools/list", async () => {
    const r = await rpc("tools/list");
    const tools = (r.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain("clinical_prepare_care_team_closure");
  });

  it("builds 3 Task + 1 CommunicationRequest + 1 DocumentReference resources", () => {
    const resources = buildCareTeamClosureResources(heroVisitContext, "packet");
    expect(resources.map((r) => r.resourceType)).toEqual([
      "Task",
      "Task",
      "Task",
      "CommunicationRequest",
      "DocumentReference",
    ]);
    const tasks = resources.filter((r) => r.resourceType === "Task");
    expect(tasks.length).toBe(3);
    for (const t of tasks) {
      expect(t.status).toBe("requested");
      expect(t.intent).toBe("order");
      expect((t.for as { reference?: string }).reference).toBe(`Patient/${HERO_PATIENT}`);
    }
    const comm = resources.find((r) => r.resourceType === "CommunicationRequest");
    expect(comm?.status).toBe("draft");
    expect(comm?.intent).toBe("proposal");
    expect((comm?.subject as { reference?: string }).reference).toBe(`Patient/${HERO_PATIENT}`);
  });

  it("validates resources against local HAPI and does not write back by default", async () => {
    const r = await rpc(
      "tools/call",
      {
        name: "clinical_prepare_care_team_closure",
        arguments: {
          visit_context: heroVisitContext,
          patient_packet_markdown: "# Su plan\n\nContenido para revisar.",
        },
      },
      sharpHeaders,
    );
    const result = r.result as { structuredContent?: unknown };
    const parsed = careTeamClosureOutputSchema.safeParse(result.structuredContent);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format())).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.resources.length).toBe(5);
    expect(parsed.data.validation_results.length).toBe(5);
    expect(parsed.data.validation_results.every((v) => v.ok)).toBe(true);
    expect(parsed.data.write_back_requested).toBe(false);
    expect(parsed.data.write_back_enabled).toBe(false);
    expect(parsed.data.write_results).toBeUndefined();
  }, 30_000);

  it("returns fhir_context_required envelope when SHARP headers are absent", async () => {
    const r = await rpc("tools/call", {
      name: "clinical_prepare_care_team_closure",
      arguments: { visit_context: heroVisitContext },
    });
    const result = r.result as { structuredContent?: { error?: string } };
    expect(result.structuredContent?.error).toBe("fhir_context_required");
  });
});

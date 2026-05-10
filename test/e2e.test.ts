/**
 * End-to-end tests — drive the Worker fetch handler with real JSON-RPC
 * requests. FHIR upstream is local HAPI for deterministic capability checks,
 * with the public HAPI sandbox still used for the self-contained dashboard smoke.
 *
 * Uses @cloudflare/vitest-pool-workers' SELF binding to run inside workerd.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const HAPI_LOCAL = "http://127.0.0.1:8080/fhir";
const HAPI_PUBLIC = "https://hapi.fhir.org/baseR4";

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

describe("MCP transport", () => {
  it("handshake exposes fhir_context_required capability", async () => {
    const r = await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(r.result).toBeTypeOf("object");
    const result = r.result as {
      capabilities: { experimental?: Record<string, { value?: unknown }> };
      serverInfo: { name: string };
    };
    expect(result.serverInfo.name).toBe("featherless");
    expect(result.capabilities.experimental?.fhir_context_required?.value).toBe(true);
  });

  it("tools/list returns the expected tool surface", async () => {
    const r = await rpc("tools/list");
    const tools = (r.result as { tools: { name: string }[] }).tools;
    const names = new Set(tools.map((t) => t.name));
    // Spot-check parity with the Python source
    for (const name of [
      "fhir_get_capability_statement",
      "fhir_get_patient",
      "fhir_search",
      "fhir_read",
      "fhir_patient_everything",
      "clinical_search_patients",
      "clinical_get_patient_summary",
      "clinical_get_problems",
      "clinical_get_medications",
      "clinical_get_allergies",
      "clinical_get_immunizations",
      "clinical_get_health_record",
      "clinical_get_encounters",
      "clinical_get_appointments",
      "lab_get_results",
      "lab_get_vital_signs",
      "lab_get_diagnostic_reports",
      "imaging_get_documents",
      "clinical_get_context",
      "visualize_lab_trend",
      "visualize_vitals",
      "visualize_patient_dashboard",
      "clinical_pack_visit_context",
    ]) {
      expect(names, `missing tool: ${name}`).toContain(name);
    }
  });

  it("permissive mode returns fhir_context_required envelope when headers absent", async () => {
    const r = await rpc("tools/call", { name: "clinical_get_problems", arguments: {} });
    const result = r.result as { structuredContent?: { error?: string } };
    expect(result.structuredContent?.error).toBe("fhir_context_required");
  });

  it("hitting fhir_get_capability_statement against local HAPI works", async () => {
    const r = await rpc(
      "tools/call",
      {
        name: "fhir_get_capability_statement",
        arguments: {},
      },
      { "X-FHIR-Server-URL": HAPI_LOCAL, "X-FHIR-Access-Token": "anonymous" },
    );
    const result = r.result as {
      structuredContent?: { fhir_version?: string; total_resource_types?: number };
    };
    expect(result.structuredContent?.fhir_version).toMatch(/^4\./);
    expect((result.structuredContent?.total_resource_types ?? 0) > 0).toBe(true);
  }, 30_000);

  it("visualize_patient_dashboard returns an MCP-UI rawHtml resource for a real HAPI patient", async () => {
    // Search for a real patient first so the test is self-contained.
    const search = await rpc(
      "tools/call",
      { name: "clinical_search_patients", arguments: { name: "Smith", count: 1 } },
      { "X-FHIR-Server-URL": HAPI_PUBLIC, "X-FHIR-Access-Token": "anonymous" },
    );
    const sc = (search.result as { structuredContent?: { patients?: { id?: string }[] } })
      .structuredContent;
    const pid = sc?.patients?.[0]?.id;
    if (!pid) {
      // HAPI is a moving target; skip if no Smith on a given day rather than fail the suite.
      console.warn("no patient found on HAPI; skipping dashboard render check");
      return;
    }
    const r = await rpc(
      "tools/call",
      {
        name: "visualize_patient_dashboard",
        arguments: { patient_id: pid, include_charts: true, lab_lookback_days: 365 },
      },
      { "X-FHIR-Server-URL": HAPI_PUBLIC, "X-FHIR-Access-Token": "anonymous" },
    );
    const result = r.result as {
      content: { type?: string; resource?: { uri: string; mimeType?: string; text?: string } }[];
    };
    expect(Array.isArray(result.content)).toBe(true);
    const ui = result.content.find((c) =>
      c.resource?.uri?.startsWith("ui://featherless/dashboard/"),
    );
    expect(ui).toBeTruthy();
    expect(ui?.resource?.text ?? "").toContain("clinical-context");
  }, 60_000);
});

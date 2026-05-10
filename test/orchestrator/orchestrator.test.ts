import { describe, expect, it } from "vitest";
import {
  DEFAULT_FHIR_EXTENSION_URI,
  createOrchestratorHandler,
  fhirContextFromMetadata,
} from "../../orchestrator/src/index.ts";
import { buildCareTeamClosureResources } from "../../src/tools/clinical-care-team-closure.ts";
import type { PatientPacketOutput } from "../../src/tools/schemas/patient-packet.ts";
import { heroVisitContext } from "../tools/fixtures.ts";

interface CapturedMcpCall {
  url: string;
  tool: string;
  headers: Record<string, string>;
  arguments: unknown;
}

const packetOutput: PatientPacketOutput = {
  language: "es-US",
  reading_level_target: "grade-6-es",
  title: "Su plan de visita, María Garcia",
  sections: {
    what_we_did_today: "Revisamos su corazón, sus medicinas y sus próximos pasos.",
    medications: [
      {
        action: "new",
        name: "furosemide",
        dose: "20 mg PO PRN",
        instructions: "Use esta medicina solo como le indicó su equipo.",
        why: "trace ankle edema",
      },
    ],
    watch_for: ["Pésese cada mañana."],
    next_steps: ["BMP en 2 semanas."],
    when_to_call: ["Llame si sube más de 1 kg en un día."],
    when_to_go_to_er: ["Vaya a emergencias si tiene dolor fuerte en el pecho."],
    citations_footer: "Lenguaje claro y pasos de acción [CIT-001].",
  },
  citations_used: ["CIT-001"],
  packet_markdown: "# Su plan de visita\n\nPésese cada mañana.",
  readability: {
    flesch_kincaid_grade: 5.8,
    inflesz_score: 72,
    word_count: 42,
    sentence_count: 5,
    target: "grade-6-es",
    meets_target: true,
  },
  grounding: {
    ok: true,
    citations_used: ["CIT-001"],
    unapproved_citations: [],
    unsupported_quotes: [],
    unknown_doses: [],
  },
  provider: "workers_ai",
  model: "@cf/openai/gpt-oss-120b",
  generated_at: "2026-05-10T00:00:00.000Z",
};

function closureOutput() {
  return {
    patient_id: heroVisitContext.patient.id,
    encounter_id: heroVisitContext.encounter.id,
    generated_at: "2026-05-10T00:00:00.000Z",
    write_back_requested: false,
    write_back_enabled: false,
    resources: buildCareTeamClosureResources(heroVisitContext, packetOutput.packet_markdown),
    validation_results: [
      { resource_type: "Task", id: "task-1", ok: true, issue_count: 0 },
      { resource_type: "Task", id: "task-2", ok: true, issue_count: 0 },
      { resource_type: "Task", id: "task-3", ok: true, issue_count: 0 },
      { resource_type: "CommunicationRequest", id: "commreq-1", ok: true, issue_count: 0 },
      { resource_type: "DocumentReference", id: "docref-1", ok: true, issue_count: 0 },
    ],
  };
}

function responseForTool(tool: string): unknown {
  if (tool === "clinical_pack_visit_context") return heroVisitContext;
  if (tool === "clinical_generate_patient_packet") return packetOutput;
  if (tool === "clinical_prepare_care_team_closure") return closureOutput();
  throw new Error(`unexpected tool ${tool}`);
}

function mockMcpFetcher(calls: CapturedMcpCall[]) {
  return mockMcpFetcherWithResponses(calls, {});
}

function mockMcpFetcherWithResponses(calls: CapturedMcpCall[], responses: Record<string, unknown>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      id?: string;
      params?: { name?: string; arguments?: unknown };
    };
    const tool = body.params?.name ?? "";
    calls.push({
      url: String(input),
      tool,
      headers: {
        "X-FHIR-Server-URL": headers.get("X-FHIR-Server-URL") ?? "",
        "X-FHIR-Access-Token": headers.get("X-FHIR-Access-Token") ?? "",
        "X-Patient-ID": headers.get("X-Patient-ID") ?? "",
      },
      arguments: body.params?.arguments,
    });
    const structuredContent = Object.hasOwn(responses, tool)
      ? responses[tool]
      : responseForTool(tool);
    return Response.json({
      jsonrpc: "2.0",
      id: body.id ?? tool,
      result: { structuredContent },
    });
  };
}

function hangingFetcher() {
  return (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
}

describe("Featherless A2A orchestrator", () => {
  it("serves a Prompt Opinion-compatible public AgentCard", async () => {
    const handler = createOrchestratorHandler();
    const res = await handler.fetch(
      new Request("https://agent.example/.well-known/agent-card.json"),
      {
        ORCHESTRATOR_URL: "https://featherless.example",
        ORCHESTRATOR_API_KEY: "secret",
      },
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const card = (await res.json()) as {
      name: string;
      url: string;
      protocolVersion: string;
      preferredTransport: string;
      supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
      capabilities: { extensions: { uri: string; required: boolean }[] };
      securitySchemes?: Record<string, unknown>;
      skills: { id: string; name: string }[];
    };

    expect(card.name).toBe("featherless");
    expect(card.url).toBe("https://featherless.example");
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.preferredTransport).toBe("JSONRPC");
    expect(card.supportedInterfaces).toEqual([
      {
        url: "https://featherless.example",
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3.0",
      },
    ]);
    expect(card.capabilities.extensions[0]?.uri).toBe(DEFAULT_FHIR_EXTENSION_URI);
    expect(card.capabilities.extensions[0]?.required).toBe(false);
    expect(card.securitySchemes?.apiKey).toBeTruthy();
    expect(card.skills[0]?.id).toBe("featherless_visit_closure");
  });

  it("extracts exact and defensive fhir-context metadata keys", () => {
    expect(
      fhirContextFromMetadata({
        [DEFAULT_FHIR_EXTENSION_URI]: {
          fhirUrl: "http://hapi.test/fhir",
          fhirToken: "token-1",
          patientId: "patient-1",
        },
      }),
    ).toEqual({
      fhirUrl: "http://hapi.test/fhir",
      fhirToken: "token-1",
      patientId: "patient-1",
    });

    expect(
      fhirContextFromMetadata({
        "http://localhost:5139/schemas/a2a/v1/fhir-context": JSON.stringify({
          fhir_url: "http://hapi.test/fhir",
          fhir_token: "token-2",
          patient_id: "patient-2",
        }),
      }),
    ).toEqual({
      fhirUrl: "http://hapi.test/fhir",
      fhirToken: "token-2",
      patientId: "patient-2",
    });
  });

  it("runs the three MCP tools in order and forwards SHARP headers without returning tokens", async () => {
    const calls: CapturedMcpCall[] = [];
    const handler = createOrchestratorHandler({ fetcher: mockMcpFetcher(calls) });
    const token = "sensitive-token-123";
    const res = await handler.fetch(
      new Request("https://agent.example/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "run-1",
          method: "message/send",
          params: {
            message: {
              role: "user",
              contextId: "ctx-1",
              parts: [{ kind: "text", text: "Generate the visit packet for the current patient." }],
              metadata: {
                [DEFAULT_FHIR_EXTENSION_URI]: {
                  fhirUrl: "http://127.0.0.1:8080/fhir",
                  fhirToken: token,
                  patientId: heroVisitContext.patient.id,
                },
              },
            },
          },
        }),
      }),
      { FEATHERLESS_MCP_URL: "https://featherless.example/mcp" },
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    const rpc = (await res.json()) as {
      result: { role: string; contextId: string; parts: { text: string }[] };
    };
    expect(rpc.result.role).toBe("agent");
    expect(rpc.result.contextId).toBe("ctx-1");

    expect(calls.map((c) => c.tool)).toEqual([
      "clinical_pack_visit_context",
      "clinical_generate_patient_packet",
      "clinical_prepare_care_team_closure",
    ]);
    for (const call of calls) {
      expect(call.url).toBe("https://featherless.example/mcp");
      expect(call.headers["X-FHIR-Server-URL"]).toBe("http://127.0.0.1:8080/fhir");
      expect(call.headers["X-FHIR-Access-Token"]).toBe(token);
      expect(call.headers["X-Patient-ID"]).toBe(heroVisitContext.patient.id);
    }

    const responseText = rpc.result.parts[0]?.text ?? "";
    expect(responseText).not.toContain(token);
    const envelope = JSON.parse(responseText) as {
      result: { patient_id: string; packet_markdown: string; closure_resources: unknown[] };
      trace: { tool: string; ms: number; ok: boolean }[];
      errors: string[];
    };
    expect(envelope.result.patient_id).toBe(heroVisitContext.patient.id);
    expect(envelope.result.packet_markdown).toContain("# Su plan");
    expect(envelope.result.closure_resources.length).toBe(6);
    expect(envelope.trace.map((h) => h.tool)).toEqual(calls.map((c) => c.tool));
    expect(envelope.trace.every((h) => h.ok && h.ms > 0)).toBe(true);
    expect(envelope.errors).toEqual([]);
  });

  it("propagates clinical tool error envelopes without contract wrapping", async () => {
    const calls: CapturedMcpCall[] = [];
    const handler = createOrchestratorHandler({
      fetcher: mockMcpFetcherWithResponses(calls, {
        clinical_generate_patient_packet: {
          error: "llm_config_required",
          message: "bind Workers AI as AI",
        },
      }),
    });
    const res = await handler.fetch(
      new Request("https://agent.example/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "run-tool-error",
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ kind: "text", text: "Generate the visit packet." }],
              metadata: {
                [DEFAULT_FHIR_EXTENSION_URI]: {
                  fhirUrl: "https://synthetic-fhir.example/r4",
                  fhirToken: "tool-error-token",
                  patientId: heroVisitContext.patient.id,
                },
              },
            },
          },
        }),
      }),
      { FEATHERLESS_MCP_URL: "https://featherless.example/mcp" },
      {} as ExecutionContext,
    );

    const rpc = (await res.json()) as { error: { code: number; message: string } };
    expect(calls.map((c) => c.tool)).toEqual([
      "clinical_pack_visit_context",
      "clinical_generate_patient_packet",
    ]);
    expect(rpc.error.code).toBe(-32000);
    expect(rpc.error.message).toContain("clinical_generate_patient_packet:llm_config_required");
    expect(rpc.error.message).not.toContain("mcp_contract_error");
    expect(rpc.error.message).not.toContain("tool-error-token");
  });

  it("routes MCP calls through the Cloudflare service binding when configured", async () => {
    const calls: CapturedMcpCall[] = [];
    const fallbackFetcher = async (): Promise<Response> => {
      throw new Error("fallback_fetcher_should_not_be_used");
    };
    const handler = createOrchestratorHandler({ fetcher: fallbackFetcher });
    const serviceBinding = { fetch: mockMcpFetcher(calls) };
    const res = await handler.fetch(
      new Request("https://agent.example/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "run-service-binding",
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ kind: "text", text: "Generate the visit packet." }],
              metadata: {
                [DEFAULT_FHIR_EXTENSION_URI]: {
                  fhirUrl: "https://synthetic-fhir.example/r4",
                  fhirToken: "service-token",
                  patientId: heroVisitContext.patient.id,
                },
              },
            },
          },
        }),
      }),
      { FEATHERLESS_MCP: serviceBinding },
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.url === "https://featherless.internal/mcp")).toBe(true);
  });

  it("fails fast when no deployable MCP target is configured", async () => {
    const calls: CapturedMcpCall[] = [];
    const handler = createOrchestratorHandler({ fetcher: mockMcpFetcher(calls) });
    const baseBody = {
      jsonrpc: "2.0",
      id: "run-missing-target",
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: "Generate the visit packet." }],
          metadata: {
            [DEFAULT_FHIR_EXTENSION_URI]: {
              fhirUrl: "https://synthetic-fhir.example/r4",
              fhirToken: "target-token",
              patientId: heroVisitContext.patient.id,
            },
          },
        },
      },
    };

    const missing = await handler.fetch(
      new Request("https://agent.example/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody),
      }),
      {},
      {} as ExecutionContext,
    );
    const missingRpc = (await missing.json()) as { error: { code: number; message: string } };
    expect(missingRpc.error.code).toBe(-32000);
    expect(missingRpc.error.message).toContain("mcp_config_required");

    const loopback = await handler.fetch(
      new Request("https://agent.example/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody),
      }),
      { FEATHERLESS_MCP_URL: "http://127.0.0.1:8787/mcp" },
      {} as ExecutionContext,
    );
    const loopbackRpc = (await loopback.json()) as { error: { code: number; message: string } };
    expect(loopbackRpc.error.code).toBe(-32000);
    expect(loopbackRpc.error.message).toContain("mcp_config_not_deployable");
    expect(calls).toHaveLength(0);
  });

  it("requires FHIR metadata and honors optional API-key protection", async () => {
    const handler = createOrchestratorHandler({ fetcher: mockMcpFetcher([]) });
    const authFail = await handler.fetch(
      new Request("https://agent.example/", { method: "POST", body: "{}" }),
      { ORCHESTRATOR_API_KEY: "secret" },
      {} as ExecutionContext,
    );
    expect(authFail.status).toBe(401);

    const noContext = await handler.fetch(
      new Request("https://agent.example/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": "secret" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "run-2",
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ kind: "text", text: "Generate the visit packet." }],
              metadata: {},
            },
          },
        }),
      }),
      { ORCHESTRATOR_API_KEY: "secret" },
      {} as ExecutionContext,
    );
    const rpc = (await noContext.json()) as { error: { code: number; message: string } };
    expect(rpc.error.code).toBe(-32001);
    expect(rpc.error.message).toContain("fhir_context_required");
  });

  it("bounds downstream MCP calls with a timeout and redacts tokens from errors", async () => {
    const handler = createOrchestratorHandler({ fetcher: hangingFetcher() });
    const token = "timeout-token-123";
    const res = await handler.fetch(
      new Request("https://agent.example/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "run-timeout",
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ kind: "text", text: "Generate the visit packet." }],
              metadata: {
                [DEFAULT_FHIR_EXTENSION_URI]: {
                  fhirUrl: "http://127.0.0.1:8080/fhir",
                  fhirToken: token,
                  patientId: heroVisitContext.patient.id,
                },
              },
            },
          },
        }),
      }),
      { FEATHERLESS_MCP_URL: "https://featherless.example/mcp", MCP_CALL_TIMEOUT_MS: "1" },
      {} as ExecutionContext,
    );

    const rpc = (await res.json()) as { error: { code: number; message: string } };
    expect(rpc.error.code).toBe(-32000);
    expect(rpc.error.message).toBe("mcp_timeout:clinical_pack_visit_context");
    expect(rpc.error.message).not.toContain(token);
  });
});

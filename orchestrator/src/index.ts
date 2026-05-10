/**
 * Featherless A2A orchestrator Worker.
 *
 * Prompt Opinion registers this Worker as an External A2A Agent by reading
 * GET /.well-known/agent-card.json. Runtime calls arrive as JSON-RPC 2.0
 * POST / message/send requests. The orchestrator extracts Prompt Opinion's
 * FHIR-context metadata and forwards it as SHARP headers to the Featherless
 * MCP Worker. It stores nothing and performs no LLM calls itself.
 */
import type { Env } from "../../src/env.ts";
import {
  type CareTeamClosureOutput,
  careTeamClosureOutputSchema,
} from "../../src/tools/schemas/care-team-closure.ts";
import {
  type PatientPacketOutput,
  patientPacketOutputSchema,
} from "../../src/tools/schemas/patient-packet.ts";
import {
  type VisitContext,
  visitContextOutputSchema,
} from "../../src/tools/schemas/visit-context.ts";

type Dict = Record<string, unknown>;
type JsonRpcId = string | number | null;
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OrchestratorEnv extends Env {
  ORCHESTRATOR_URL?: string;
  FHIR_EXTENSION_URI?: string;
  ORCHESTRATOR_API_KEY?: string;
  MCP_CALL_TIMEOUT_MS?: string;
}

export interface FhirContext {
  fhirUrl: string;
  fhirToken: string;
  patientId: string;
}

export interface TraceHop {
  tool: string;
  started_at: string;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface WorkflowEnvelope {
  result: {
    patient_id: string;
    encounter_id: string;
    packet_markdown: string;
    readability: PatientPacketOutput["readability"];
    grounding: PatientPacketOutput["grounding"];
    closure_resources: CareTeamClosureOutput["resources"];
    validation_results: CareTeamClosureOutput["validation_results"];
    write_back_requested: boolean;
    write_back_enabled: boolean;
  };
  trace: TraceHop[];
  errors: string[];
}

export interface OrchestratorHandler {
  fetch(request: Request, env: OrchestratorEnv, ctx: ExecutionContext): Promise<Response>;
}

export const DEFAULT_FHIR_EXTENSION_URI =
  "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context";

const AGENT_CARD_PATH = "/.well-known/agent-card.json";
const DEFAULT_MCP_CALL_TIMEOUT_MS = 10_000;
const SERVICE_BINDING_MCP_URL = "https://featherless.internal/mcp";
const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const FHIR_SCOPES = [
  { name: "patient/Patient.rs", required: true },
  { name: "patient/Encounter.rs", required: true },
  { name: "patient/Condition.rs", required: true },
  { name: "patient/MedicationRequest.rs", required: true },
  { name: "patient/MedicationStatement.rs" },
  { name: "patient/AllergyIntolerance.rs" },
  { name: "patient/Immunization.rs" },
  { name: "patient/DiagnosticReport.rs" },
  { name: "patient/Procedure.rs" },
  { name: "patient/Observation.rs", required: true },
  { name: "patient/ServiceRequest.rs", required: true },
  { name: "patient/Appointment.rs" },
  { name: "patient/DocumentReference.rs", required: true },
  { name: "patient/Coverage.rs" },
];

function asDict(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function publicBaseUrl(request: Request, env: OrchestratorEnv): string {
  return cleanBaseUrl(env.ORCHESTRATOR_URL ?? new URL(request.url).origin);
}

function extensionUri(env: OrchestratorEnv): string {
  return env.FHIR_EXTENSION_URI ?? DEFAULT_FHIR_EXTENSION_URI;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function deployableMcpUrl(request: Request, configuredUrl: string): string {
  const url = cleanBaseUrl(configuredUrl.trim());
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("mcp_config_invalid: FEATHERLESS_MCP_URL must be an absolute URL.");
  }

  const requestHostname = new URL(request.url).hostname;
  const targetIsLoopback = isLoopbackHostname(parsed.hostname);
  const requestIsLoopback = isLoopbackHostname(requestHostname);
  if (targetIsLoopback && !requestIsLoopback) {
    throw new Error(
      "mcp_config_not_deployable: FEATHERLESS_MCP_URL points to loopback from a public request.",
    );
  }
  if (parsed.protocol !== "https:" && !targetIsLoopback) {
    throw new Error(
      "mcp_config_not_deployable: FEATHERLESS_MCP_URL must be HTTPS outside local development.",
    );
  }
  return url;
}

function mcpTarget(
  request: Request,
  env: OrchestratorEnv,
  defaultFetcher: FetchFn,
): { fetcher: FetchFn; url: string } {
  const configured = env.FEATHERLESS_MCP_URL?.trim();
  if (configured) {
    return { fetcher: defaultFetcher, url: deployableMcpUrl(request, configured) };
  }

  if (env.FEATHERLESS_MCP) {
    return {
      fetcher: (input, init) =>
        env.FEATHERLESS_MCP?.fetch(input, init) ?? defaultFetcher(input, init),
      url: SERVICE_BINDING_MCP_URL,
    };
  }

  throw new Error(
    "mcp_config_required: bind FEATHERLESS_MCP or set FEATHERLESS_MCP_URL to the deployed MCP endpoint.",
  );
}

function mcpCallTimeoutMs(env: OrchestratorEnv): number {
  const parsed = Number(env.MCP_CALL_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MCP_CALL_TIMEOUT_MS;
}

export function agentCardFor(request: Request, env: OrchestratorEnv): Dict {
  const apiKeyRequired = Boolean(env.ORCHESTRATOR_API_KEY);
  const base = publicBaseUrl(request, env);
  const card: Dict = {
    name: "featherless",
    description:
      "Turns the current FHIR visit into a citation-grounded patient packet and care-team closure resources through Featherless MCP tools.",
    url: base,
    version: "1.0.0",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
      extensions: [
        {
          uri: extensionUri(env),
          description: "FHIR launch context propagated by Prompt Opinion as A2A message metadata.",
          required: false,
          params: { scopes: FHIR_SCOPES },
        },
      ],
    },
    skills: [
      {
        id: "featherless_visit_closure",
        name: "Featherless visit closure",
        description:
          "Generate a plain-language visit packet, validate closure FHIR resources, and return an auditable trace.",
        tags: ["FHIR", "SHARP", "MCP", "patient-education"],
        examples: ["Generate the visit packet for the current patient."],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
  };
  if (apiKeyRequired) {
    card.securitySchemes = {
      apiKey: {
        type: "apiKey",
        name: "X-API-Key",
        in: "header",
        description: "API key required to invoke the Featherless A2A endpoint.",
      },
    };
    card.security = [{ apiKey: [] }];
  }
  return card;
}

function textFromMessage(message: Dict): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const lines: string[] = [];
  for (const part of parts) {
    const p = asDict(part);
    if (!p) continue;
    const kind = typeof p.kind === "string" ? p.kind : p.type;
    if (kind !== "text") continue;
    if (typeof p.text === "string") lines.push(p.text);
  }
  return lines.join("\n").trim();
}

function parseMetadataValue(value: unknown): Dict | null {
  if (typeof value === "string") {
    try {
      return asDict(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asDict(value);
}

function firstString(obj: Dict, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function fhirContextFromMetadata(
  metadata: Dict,
  preferredExtensionUri = DEFAULT_FHIR_EXTENSION_URI,
): FhirContext | null {
  const exact = parseMetadataValue(metadata[preferredExtensionUri]);
  const candidates = exact ? [exact] : [];
  for (const [key, value] of Object.entries(metadata)) {
    if (key === preferredExtensionUri) continue;
    if (key.includes("fhir-context")) {
      const parsed = parseMetadataValue(value);
      if (parsed) candidates.push(parsed);
    }
  }
  for (const candidate of candidates) {
    const fhirUrl = firstString(candidate, ["fhirUrl", "fhir_url", "url"]);
    const fhirToken = firstString(candidate, ["fhirToken", "fhir_token", "accessToken"]);
    const patientId = firstString(candidate, ["patientId", "patient_id", "patient"]);
    if (fhirUrl && fhirToken && patientId) return { fhirUrl, fhirToken, patientId };
  }
  return null;
}

function sanitize(message: string, fhir?: FhirContext): string {
  let out = message;
  if (fhir?.fhirToken) out = out.split(fhir.fhirToken).join("[redacted]");
  return out.replace(/"fhirToken"\s*:\s*"[^"]+"/g, '"fhirToken":"[redacted]"');
}

function rpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): Response {
  const body = { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
  return Response.json(body, { status: 200, headers: JSON_HEADERS });
}

function rpcSuccess(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: JSON_HEADERS });
}

async function readJson(request: Request): Promise<Dict | null> {
  try {
    return asDict(await request.json());
  } catch {
    return null;
  }
}

async function parseResponseJson(res: Response, tool: string): Promise<Dict> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`mcp_invalid_json:${tool}:status_${res.status}`);
  }
  const obj = asDict(json);
  if (!obj) throw new Error(`mcp_invalid_response:${tool}`);
  return obj;
}

function structuredContentFromMcp(json: Dict, tool: string): unknown {
  const err = asDict(json.error);
  if (err) {
    const message = typeof err.message === "string" ? err.message : "unknown_error";
    throw new Error(`mcp_error:${tool}:${message}`);
  }
  const result = asDict(json.result);
  if (!result) throw new Error(`mcp_missing_result:${tool}`);
  if ("structuredContent" in result) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  const first = asDict(content[0]);
  if (first && typeof first.text === "string") {
    try {
      return JSON.parse(first.text);
    } catch {
      throw new Error(`mcp_unstructured_text:${tool}`);
    }
  }
  throw new Error(`mcp_missing_structured_content:${tool}`);
}

async function callMcpTool(
  fetcher: FetchFn,
  url: string,
  fhir: FhirContext,
  tool: string,
  args: Dict,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetcher(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-FHIR-Server-URL": fhir.fhirUrl,
        "X-FHIR-Access-Token": fhir.fhirToken,
        "X-Patient-ID": fhir.patientId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: tool,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    });
  } catch (e) {
    if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      throw new Error(`mcp_timeout:${tool}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`mcp_http_error:${tool}:status_${res.status}`);
  return structuredContentFromMcp(await parseResponseJson(res, tool), tool);
}

function schemaError(label: string, error: { message: string }): Error {
  return new Error(`mcp_contract_error:${label}:${error.message}`);
}

function toolFailure(tool: string, value: unknown): Error | null {
  const obj = asDict(value);
  if (!obj || typeof obj.error !== "string") return null;
  const message = typeof obj.message === "string" ? obj.message : obj.error;
  return new Error(`${tool}:${obj.error}:${message}`);
}

export async function runFeatherlessWorkflow(input: {
  fetcher: FetchFn;
  mcpUrl: string;
  fhir: FhirContext;
  timeoutMs?: number;
}): Promise<WorkflowEnvelope> {
  const trace: TraceHop[] = [];

  const tracedCall = async (tool: string, args: Dict): Promise<unknown> => {
    const started_at = new Date().toISOString();
    const start = Date.now();
    try {
      const result = await callMcpTool(
        input.fetcher,
        input.mcpUrl,
        input.fhir,
        tool,
        args,
        input.timeoutMs ?? DEFAULT_MCP_CALL_TIMEOUT_MS,
      );
      const failure = toolFailure(tool, result);
      if (failure) throw failure;
      trace.push({ tool, started_at, ms: Math.max(1, Date.now() - start), ok: true });
      return result;
    } catch (e) {
      const message = sanitize(e instanceof Error ? e.message : String(e), input.fhir);
      trace.push({
        tool,
        started_at,
        ms: Math.max(1, Date.now() - start),
        ok: false,
        error: message,
      });
      throw new Error(message);
    }
  };

  const visitRaw = await tracedCall("clinical_pack_visit_context", {
    patient_id: input.fhir.patientId,
  });
  const visitParsed = visitContextOutputSchema.safeParse(visitRaw);
  if (!visitParsed.success) throw schemaError("clinical_pack_visit_context", visitParsed.error);
  const visitContext: VisitContext = visitParsed.data;

  const packetRaw = await tracedCall("clinical_generate_patient_packet", {
    visit_context: visitContext,
  });
  const packetParsed = patientPacketOutputSchema.safeParse(packetRaw);
  if (!packetParsed.success) {
    throw schemaError("clinical_generate_patient_packet", packetParsed.error);
  }
  const packet = packetParsed.data;

  const closureRaw = await tracedCall("clinical_prepare_care_team_closure", {
    visit_context: visitContext,
    patient_packet_markdown: packet.packet_markdown,
  });
  const closureParsed = careTeamClosureOutputSchema.safeParse(closureRaw);
  if (!closureParsed.success) {
    throw schemaError("clinical_prepare_care_team_closure", closureParsed.error);
  }
  const closure = closureParsed.data;

  return {
    result: {
      patient_id: visitContext.patient.id,
      encounter_id: visitContext.encounter.id,
      packet_markdown: packet.packet_markdown,
      readability: packet.readability,
      grounding: packet.grounding,
      closure_resources: closure.resources,
      validation_results: closure.validation_results,
      write_back_requested: closure.write_back_requested,
      write_back_enabled: closure.write_back_enabled,
    },
    trace,
    errors: [],
  };
}

function a2aMessage(envelope: WorkflowEnvelope, contextId: string): Dict {
  return {
    kind: "message",
    messageId: crypto.randomUUID(),
    role: "agent",
    parts: [{ kind: "text", text: JSON.stringify(envelope, null, 2) }],
    contextId,
    metadata: {
      "featherless/trace": envelope.trace,
      "featherless/patient_id": envelope.result.patient_id,
      "featherless/encounter_id": envelope.result.encounter_id,
    },
  };
}

async function handleMessageSend(
  body: Dict,
  request: Request,
  env: OrchestratorEnv,
  fetcher: FetchFn,
): Promise<Response> {
  const id = rpcId(body.id);
  const params = asDict(body.params) ?? {};
  const message = asDict(params.message);
  if (!message) return rpcError(id, -32602, "Invalid params: message is required.");
  const prompt = textFromMessage(message);
  if (!prompt) {
    return rpcError(id, -32602, "Invalid params: at least one text message part is required.");
  }

  const metadata = asDict(message.metadata) ?? {};
  const fhir = fhirContextFromMetadata(metadata, extensionUri(env));
  if (!fhir) {
    return rpcError(
      id,
      -32001,
      "fhir_context_required: include A2A message metadata with fhirUrl, fhirToken, and patientId.",
    );
  }

  const contextId =
    firstString(message, ["contextId", "context_id"]) ??
    firstString(params, ["contextId", "context_id"]) ??
    crypto.randomUUID();

  try {
    const target = mcpTarget(request, env, fetcher);
    const envelope = await runFeatherlessWorkflow({
      fetcher: target.fetcher,
      mcpUrl: target.url,
      fhir,
      timeoutMs: mcpCallTimeoutMs(env),
    });
    return rpcSuccess(id, a2aMessage(envelope, contextId));
  } catch (e) {
    return rpcError(id, -32000, sanitize(e instanceof Error ? e.message : String(e), fhir));
  }
}

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": "ApiKey", ...JSON_HEADERS },
  });
}

function apiKeyFailure(request: Request, env: OrchestratorEnv): Response | null {
  if (!env.ORCHESTRATOR_API_KEY) return null;
  return request.headers.get("X-API-Key") === env.ORCHESTRATOR_API_KEY ? null : unauthorized();
}

export function createOrchestratorHandler(
  options: { fetcher?: FetchFn } = {},
): OrchestratorHandler {
  const fetcher = options.fetcher ?? fetch;
  return {
    async fetch(request: Request, env: OrchestratorEnv): Promise<Response> {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: JSON_HEADERS });

      const url = new URL(request.url);
      if (url.pathname === AGENT_CARD_PATH) {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
        }
        return Response.json(agentCardFor(request, env), { headers: JSON_HEADERS });
      }
      if (url.pathname === "/health") return new Response("ok");
      if ((url.pathname === "/" || url.pathname === "") && request.method === "GET") {
        return new Response("Featherless A2A orchestrator", {
          headers: { "Content-Type": "text/plain" },
        });
      }
      if ((url.pathname === "/" || url.pathname === "") && request.method === "POST") {
        const auth = apiKeyFailure(request, env);
        if (auth) return auth;
        const body = await readJson(request);
        if (!body) return rpcError(null, -32700, "Parse error");
        if (body.method !== "message/send") {
          return rpcError(rpcId(body.id), -32601, `Method not found: ${String(body.method)}`);
        }
        return handleMessageSend(body, request, env, fetcher);
      }
      return new Response("Not Found", { status: 404 });
    },
  };
}

export default createOrchestratorHandler() satisfies ExportedHandler<OrchestratorEnv>;

import { MemoryClient } from "./clients/memory-client.ts";
import type { Env } from "./env.ts";
/**
 * Featherless MCP server — SHARP-on-MCP compliant FHIR R4 server on Cloudflare Workers.
 *
 * Advertises `capabilities.experimental.fhir_context_required = true` so
 * SHARP-aware MCP clients/agents know to forward the FHIR headers on
 * every tool call.
 *
 * Also injects the Prompt Opinion Platform's `extensions["ai.promptopinion/fhir-context"]`
 * scope advertisement, mirroring `sharp-fhir-mcp`.
 */
import { McpServer } from "./mcp/server.ts";
import { registerClinicalCareTeamClosureTools } from "./tools/clinical-care-team-closure.ts";
import { registerClinicalContextTools } from "./tools/clinical-context.ts";
import { registerClinicalPatientPacketTools } from "./tools/clinical-patient-packet.ts";
import { registerClinicalVisitContextTools } from "./tools/clinical-visit-context.ts";
import { registerClinicalTools } from "./tools/clinical.ts";
import { registerFhirTools } from "./tools/fhir.ts";
import { registerLabImagingTools } from "./tools/lab-imaging.ts";
import { registerMemoryTools } from "./tools/memory.ts";
import { registerVisualizationTools } from "./tools/visualization.ts";

export const SERVER_NAME = "featherless";
export const SERVER_VERSION = "0.1.0";

const SERVER_INSTRUCTIONS =
  "SHARP-on-MCP compliant FHIR R4 MCP server. Provides clinical tools (FHIR " +
  "search/read, patient context, labs, vitals, appointments, medications, " +
  "allergies, immunizations) plus interactive MCP-UI dashboards and " +
  "optional cross-session clinical memory (Cloudflare Vectorize + Workers AI). " +
  "Healthcare context is supplied by the agent on every request via the " +
  "X-FHIR-Server-URL, X-FHIR-Access-Token, and X-Patient-ID headers (per SHARP §3.2).";

const PO_FHIR_CONTEXT_EXTENSION = {
  scopes: [
    { name: "patient/Patient.rs", required: true },
    { name: "patient/Observation.rs" },
    { name: "patient/Condition.rs" },
    { name: "patient/MedicationRequest.rs" },
    { name: "patient/MedicationStatement.rs" },
    { name: "patient/AllergyIntolerance.rs" },
    { name: "patient/Immunization.rs" },
    { name: "patient/DiagnosticReport.rs" },
    { name: "patient/Procedure.rs" },
    { name: "patient/ServiceRequest.rs" },
    { name: "patient/Encounter.rs" },
    { name: "patient/Appointment.rs" },
    { name: "patient/DocumentReference.rs" },
    { name: "patient/Coverage.rs" },
  ],
};

export function buildServer(env: Env): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, instructions: SERVER_INSTRUCTIONS },
    {
      experimental: {
        fhir_context_required: { value: true },
      },
      extensions: {
        "ai.promptopinion/fhir-context": PO_FHIR_CONTEXT_EXTENSION,
      },
    },
  );

  registerFhirTools(server);
  registerClinicalTools(server);
  registerLabImagingTools(server);
  registerClinicalContextTools(server);
  registerVisualizationTools(server);
  registerClinicalVisitContextTools(server);
  registerClinicalPatientPacketTools(server, env);
  registerClinicalCareTeamClosureTools(server, env);

  const memory = MemoryClient.fromEnv(env);
  registerMemoryTools(server, memory);

  return server;
}
